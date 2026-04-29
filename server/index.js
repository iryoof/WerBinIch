const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");


const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Serve static frontend in production
const clientBuildPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientBuildPath));

// ── State ──────────────────────────────────────────────────────────────────────
const lobbies = new Map(); // code -> Lobby
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createLobby(hostSocket, hostName) {
  let code = generateCode();
  while (lobbies.has(code)) code = generateCode();

  const lobby = {
    code,
    players: [{
      id: hostSocket.id,
      name: hostName,
      isHost: true,
      reconnectKey: crypto.randomUUID(),
      connected: true,
      disconnectedAt: null,
    }],
    state: "waiting", // waiting | writing | playing
    assignments: {},  // playerId -> targetPlayerId (who they write for)
    words: {},        // targetPlayerId -> { word, authorId }
    solved: {},       // playerId -> boolean
    solvedInfo: {},   // playerId -> { word, authorName }
  };
  lobbies.set(code, lobby);
  return lobby;
}

function createPlayer(socket, name, isHost = false) {
  return {
    id: socket.id,
    name,
    isHost,
    reconnectKey: crypto.randomUUID(),
    connected: true,
    disconnectedAt: null,
  };
}

function findLobbyByPlayer(socketId) {
  for (const [, lobby] of lobbies) {
    if (lobby.players.some((p) => p.id === socketId)) return lobby;
  }
  return null;
}

function broadcastLobby(lobby) {
  const sanitized = {
    code: lobby.code,
    state: lobby.state,
    players: lobby.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected !== false,
    })),
  };
  lobby.players.filter((p) => p.connected !== false).forEach((p) => {
    io.to(p.id).emit("lobby:update", sanitized);
  });
}

function broadcastGameState(lobby) {
  lobby.players.filter((p) => p.connected !== false).forEach((player) => {
    // Build visible list: all OTHER players with their word (if written)
    const others = lobby.players
      .filter((p) => p.id !== player.id)
      .map((p) => {
        const wordEntry = lobby.words[p.id]; // word assigned TO this player
        return {
          id: p.id,
          name: p.name,
          word: wordEntry ? wordEntry.word : null,
          solved: !!lobby.solved[p.id],
        };
      });

    const myWordEntry = lobby.words[player.id];
    const iSolved = !!lobby.solved[player.id];
    const solvedInfo = lobby.solvedInfo[player.id] || null;

    // Check if I need to write a word
    const myAssignmentTarget = lobby.assignments[player.id];
    const targetWordExists = myAssignmentTarget ? !!lobby.words[myAssignmentTarget] : true;

    io.to(player.id).emit("game:state", {
      state: lobby.state,
      others,
      myWord: iSolved && solvedInfo ? solvedInfo.word : null,
      myWordAuthor: iSolved && solvedInfo ? solvedInfo.authorName : null,
      iSolved,
      needsToWrite: lobby.state === "writing" && !targetWordExists,
      writeForPlayer: myAssignmentTarget
        ? lobby.players.find((p) => p.id === myAssignmentTarget)?.name || null
        : null,
      writeForPlayerId: myAssignmentTarget || null,
      allWordsWritten: checkAllWordsWritten(lobby),
      isHost: player.isHost,
      players: lobby.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected !== false,
      })),
    });
  });
}

function checkAllWordsWritten(lobby) {
  return lobby.players.every((p) => !!lobby.words[p.id]);
}

function assignPlayers(lobby) {
  // Fisher-Yates derangement: every player gets assigned a DIFFERENT player
  const ids = lobby.players.map((p) => p.id);
  let shuffled;
  do {
    shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  } while (shuffled.some((id, idx) => id === ids[idx]));

  lobby.assignments = {};
  ids.forEach((id, idx) => {
    lobby.assignments[id] = shuffled[idx]; // player `id` writes for player `shuffled[idx]`
  });
}

function rekeyObject(obj, oldKey, newKey) {
  if (!Object.prototype.hasOwnProperty.call(obj, oldKey)) return;
  obj[newKey] = obj[oldKey];
  delete obj[oldKey];
}

function remapPlayerId(lobby, oldId, newId) {
  if (oldId === newId) return;
  const player = lobby.players.find((p) => p.id === oldId);
  if (!player) return;
  player.id = newId;

  if (lobby.assignments[oldId]) {
    lobby.assignments[newId] = lobby.assignments[oldId];
    delete lobby.assignments[oldId];
  }
  for (const [assignee, target] of Object.entries(lobby.assignments)) {
    if (target === oldId) {
      lobby.assignments[assignee] = newId;
    }
  }

  rekeyObject(lobby.words, oldId, newId);
  rekeyObject(lobby.solved, oldId, newId);
  rekeyObject(lobby.solvedInfo, oldId, newId);
  Object.values(lobby.words).forEach((entry) => {
    if (entry?.authorId === oldId) entry.authorId = newId;
  });
}

function findPlayerSessionByReconnectKey(reconnectKey) {
  for (const [, lobby] of lobbies) {
    const player = lobby.players.find((p) => p.reconnectKey === reconnectKey);
    if (player) return { lobby, player };
  }
  return null;
}

function pruneExpiredDisconnectedPlayers() {
  const now = Date.now();
  for (const [, lobby] of lobbies) {
    const expiredIds = lobby.players
      .filter((p) => p.connected === false && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS)
      .map((p) => p.id);
    expiredIds.forEach((playerId) => removePlayerFromLobby(lobby, playerId));
  }
}

function removePlayerFromLobby(lobby, playerId) {
  const leavingPlayer = lobby.players.find((p) => p.id === playerId);
  if (!leavingPlayer) return;
  const wasHost = leavingPlayer.isHost;
  lobby.players = lobby.players.filter((p) => p.id !== playerId);

  if (lobby.players.length === 0) {
    lobbies.delete(lobby.code);
    return;
  }

  if (wasHost) {
    const nextHost = lobby.players.find((p) => p.connected !== false) || lobby.players[0];
    nextHost.isHost = true;
  }

  if (lobby.state === "waiting") {
    broadcastLobby(lobby);
    return;
  }

  delete lobby.assignments[playerId];
  delete lobby.words[playerId];
  delete lobby.solved[playerId];
  delete lobby.solvedInfo[playerId];
  for (const [assignee, target] of Object.entries(lobby.assignments)) {
    if (target === playerId) {
      delete lobby.assignments[assignee];
    }
  }
  broadcastGameState(lobby);
}

// ── Socket Handlers ────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.on("session:resume", ({ reconnectKey }, callback) => {
    if (!reconnectKey || typeof reconnectKey !== "string") {
      return callback?.({ error: "Ungültiger Reconnect-Key." });
    }
    const session = findPlayerSessionByReconnectKey(reconnectKey);
    if (!session) {
      return callback?.({ error: "Session nicht gefunden." });
    }

    const { lobby, player } = session;
    const oldId = player.id;
    remapPlayerId(lobby, oldId, socket.id);
    player.connected = true;
    player.disconnectedAt = null;
    socket.join(lobby.code);

    if (lobby.state === "waiting") {
      broadcastLobby(lobby);
    } else {
      broadcastGameState(lobby);
    }
    callback?.({ ok: true, code: lobby.code, name: player.name, state: lobby.state });
  });

  // Create lobby
  socket.on("lobby:create", (name, callback) => {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return callback({ error: "Name darf nicht leer sein." });
    }
    const lobby = createLobby(socket, name.trim());
    socket.join(lobby.code);
    broadcastLobby(lobby);
    const host = lobby.players.find((p) => p.id === socket.id);
    callback({ code: lobby.code, reconnectKey: host.reconnectKey, name: host.name });
  });

  // Join lobby
  socket.on("lobby:join", ({ name, code }, callback) => {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return callback({ error: "Name darf nicht leer sein." });
    }
    if (!code || typeof code !== "string") {
      return callback({ error: "Code darf nicht leer sein." });
    }
    const normalizedCode = code.trim().toUpperCase();
    const lobby = lobbies.get(normalizedCode);
    if (!lobby) return callback({ error: "Lobby nicht gefunden." });
    if (lobby.state !== "waiting") return callback({ error: "Das Spiel hat bereits begonnen." });
    if (lobby.players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
      return callback({ error: "Dieser Name ist bereits vergeben." });
    }

    const player = createPlayer(socket, name.trim(), false);
    lobby.players.push(player);
    socket.join(lobby.code);
    broadcastLobby(lobby);
    callback({ code: lobby.code, reconnectKey: player.reconnectKey, name: player.name });
  });

  // Start game (host only)
  socket.on("game:start", (callback) => {
    const lobby = findLobbyByPlayer(socket.id);
    if (!lobby) return callback?.({ error: "Lobby nicht gefunden." });
    const player = lobby.players.find((p) => p.id === socket.id);
    if (!player?.isHost) return callback?.({ error: "Nur der Host kann das Spiel starten." });
    if (lobby.players.length < 2) return callback?.({ error: "Mindestens 2 Spieler erforderlich." });

    lobby.state = "writing";
    lobby.words = {};
    lobby.solved = {};
    lobby.solvedInfo = {};
    assignPlayers(lobby);
    broadcastGameState(lobby);
    callback?.({ ok: true });
  });

  // Submit word
  socket.on("game:submitWord", ({ word }, callback) => {
    const lobby = findLobbyByPlayer(socket.id);
    if (!lobby) return callback?.({ error: "Lobby nicht gefunden." });
    if (!word || typeof word !== "string" || word.trim().length === 0) {
      return callback?.({ error: "Wort darf nicht leer sein." });
    }

    const targetId = lobby.assignments[socket.id];
    if (!targetId) return callback?.({ error: "Kein Ziel zugewiesen." });

    lobby.words[targetId] = { word: word.trim(), authorId: socket.id };
    callback?.({ ok: true });

    if (checkAllWordsWritten(lobby)) {
      lobby.state = "playing";
    }
    broadcastGameState(lobby);
  });

  // Solve
  socket.on("game:solve", (callback) => {
    const lobby = findLobbyByPlayer(socket.id);
    if (!lobby || lobby.state !== "playing") return callback?.({ error: "Spiel läuft nicht." });

    const wordEntry = lobby.words[socket.id];
    if (!wordEntry) return callback?.({ error: "Kein Wort vorhanden." });

    lobby.solved[socket.id] = true;
    const author = lobby.players.find((p) => p.id === wordEntry.authorId);
    lobby.solvedInfo[socket.id] = {
      word: wordEntry.word,
      authorName: author ? author.name : "Unbekannt",
    };

    broadcastGameState(lobby);
    callback?.({ ok: true, word: wordEntry.word, authorName: author?.name || "Unbekannt" });
  });

  // Write new word for a solved player
  socket.on("game:writeNewWord", ({ targetId, word }, callback) => {
    const lobby = findLobbyByPlayer(socket.id);
    if (!lobby || lobby.state !== "playing") return callback?.({ error: "Spiel läuft nicht." });
    if (!word || typeof word !== "string" || word.trim().length === 0) {
      return callback?.({ error: "Wort darf nicht leer sein." });
    }
    if (targetId === socket.id) return callback?.({ error: "Du kannst dir nicht selbst ein Wort geben." });

    lobby.words[targetId] = { word: word.trim(), authorId: socket.id };
    lobby.solved[targetId] = false;
    lobby.solvedInfo[targetId] = null;

    broadcastGameState(lobby);
    callback?.({ ok: true });
  });

  // Leave lobby
  socket.on("lobby:leave", () => {
    handleSocketDisconnected(socket);
  });

  // Close lobby (host only)
  socket.on("lobby:close", () => {
    const lobby = findLobbyByPlayer(socket.id);
    if (!lobby) return;
    const player = lobby.players.find((p) => p.id === socket.id);
    if (!player?.isHost) return;

    lobby.players.forEach((p) => {
      io.to(p.id).emit("lobby:closed");
    });
    lobbies.delete(lobby.code);
  });

  socket.on("disconnect", () => {
    handleSocketDisconnected(socket);
  });
});

function handleSocketDisconnected(socket) {
  const lobby = findLobbyByPlayer(socket.id);
  if (!lobby) return;
  const player = lobby.players.find((p) => p.id === socket.id);
  if (!player) return;
  player.connected = false;
  player.disconnectedAt = Date.now();

  if (lobby.state === "waiting") {
    broadcastLobby(lobby);
  } else {
    broadcastGameState(lobby);
  }
}

setInterval(pruneExpiredDisconnectedPlayers, 15 * 1000);

// Catch-all: serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");


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
    players: [{ id: hostSocket.id, name: hostName, isHost: true }],
    state: "waiting", // waiting | writing | playing
    assignments: {},  // playerId -> targetPlayerId (who they write for)
    words: {},        // targetPlayerId -> { word, authorId }
    solved: {},       // playerId -> boolean
    solvedInfo: {},   // playerId -> { word, authorName }
  };
  lobbies.set(code, lobby);
  return lobby;
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
    })),
  };
  lobby.players.forEach((p) => {
    io.to(p.id).emit("lobby:update", sanitized);
  });
}

function broadcastGameState(lobby) {
  lobby.players.forEach((player) => {
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

// ── Socket Handlers ────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // Create lobby
  socket.on("lobby:create", (name, callback) => {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return callback({ error: "Name darf nicht leer sein." });
    }
    const lobby = createLobby(socket, name.trim());
    socket.join(lobby.code);
    broadcastLobby(lobby);
    callback({ code: lobby.code });
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

    lobby.players.push({ id: socket.id, name: name.trim(), isHost: false });
    socket.join(lobby.code);
    broadcastLobby(lobby);
    callback({ code: lobby.code });
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
    handleDisconnect(socket);
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
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket) {
  const lobby = findLobbyByPlayer(socket.id);
  if (!lobby) return;

  const leavingPlayer = lobby.players.find((p) => p.id === socket.id);
  const wasHost = leavingPlayer?.isHost;
  lobby.players = lobby.players.filter((p) => p.id !== socket.id);

  if (lobby.players.length === 0) {
    lobbies.delete(lobby.code);
    return;
  }

  // Transfer host to next player
  if (wasHost && lobby.players.length > 0) {
    lobby.players[0].isHost = true;
  }

  if (lobby.state === "waiting") {
    broadcastLobby(lobby);
  } else {
    // Clean up assignments/words related to disconnected player
    delete lobby.assignments[socket.id];
    delete lobby.words[socket.id];
    delete lobby.solved[socket.id];
    delete lobby.solvedInfo[socket.id];

    // Remove assignments pointing to disconnected player
    for (const [assignee, target] of Object.entries(lobby.assignments)) {
      if (target === socket.id) {
        delete lobby.assignments[assignee];
      }
    }

    broadcastGameState(lobby);
  }
}

// Catch-all: serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuildPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

import { useState, useEffect } from "react";
import { socket } from "./socket";
import MainMenu from "./components/MainMenu";
import Lobby from "./components/Lobby";
import Game from "./components/Game";
import "./App.css";

const SESSION_STORAGE_KEY = "werbinich:session";

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.reconnectKey || !parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function App() {
  const [screen, setScreen] = useState("menu"); // menu | lobby | game
  const [lobbyData, setLobbyData] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [myName, setMyName] = useState("");
  const [error, setError] = useState("");

  const tryResumeSession = () => {
    const session = readStoredSession();
    if (!session?.reconnectKey) {
      setError("Keine gespeicherte Session gefunden.");
      return;
    }
    socket.emit("session:resume", { reconnectKey: session.reconnectKey }, (res) => {
      if (res?.ok) {
        setMyName(res.name || session.name);
        setError("");
        return;
      }
      clearStoredSession();
      setScreen("menu");
      setLobbyData(null);
      setGameData(null);
      setError(res?.error || "Reconnect fehlgeschlagen.");
    });
  };

  useEffect(() => {
    socket.on("connect", tryResumeSession);

    socket.on("lobby:update", (data) => {
      setLobbyData(data);
      setScreen("lobby");
    });

    socket.on("game:state", (data) => {
      setGameData(data);
      if (data.state === "writing" || data.state === "playing") {
        setScreen("game");
      }
    });

    socket.on("lobby:closed", () => {
      clearStoredSession();
      setScreen("menu");
      setLobbyData(null);
      setGameData(null);
      setError("Die Lobby wurde geschlossen.");
    });

    socket.on("disconnect", () => {
      setError("Verbindung getrennt. Reconnect wird versucht...");
    });

    tryResumeSession();

    return () => {
      socket.off("connect", tryResumeSession);
      socket.off("lobby:update");
      socket.off("game:state");
      socket.off("lobby:closed");
      socket.off("disconnect");
    };
  }, []);

  const handleCreate = (name) => {
    setMyName(name);
    setError("");
    socket.emit("lobby:create", name, (res) => {
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res?.reconnectKey) {
        writeStoredSession({
          reconnectKey: res.reconnectKey,
          name: res.name || name,
          code: res.code,
        });
      }
    });
  };

  const handleJoin = (name, code) => {
    setMyName(name);
    setError("");
    socket.emit("lobby:join", { name, code }, (res) => {
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res?.reconnectKey) {
        writeStoredSession({
          reconnectKey: res.reconnectKey,
          name: res.name || name,
          code: res.code || code,
        });
      }
    });
  };

  const handleLeave = () => {
    socket.emit("lobby:leave");
    setScreen("menu");
    setLobbyData(null);
    setGameData(null);
    setError("");
  };

  return (
    <div className="app">
      <div className="app-bg" />
      {screen === "menu" && (
        <MainMenu
          onCreateLobby={handleCreate}
          onJoinLobby={handleJoin}
          error={error}
          clearError={() => setError("")}
        />
      )}
      {screen === "lobby" && lobbyData && (
        <Lobby
          lobby={lobbyData}
          myName={myName}
          onLeave={handleLeave}
          onError={setError}
          error={error}
        />
      )}
      {screen === "game" && gameData && (
        <Game
          game={gameData}
          myName={myName}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}

export default App;

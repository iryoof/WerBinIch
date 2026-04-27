import { useState, useEffect } from "react";
import { socket } from "./socket";
import MainMenu from "./components/MainMenu";
import Lobby from "./components/Lobby";
import Game from "./components/Game";
import "./App.css";

function App() {
  const [screen, setScreen] = useState("menu"); // menu | lobby | game
  const [lobbyData, setLobbyData] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [myName, setMyName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
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
      setScreen("menu");
      setLobbyData(null);
      setGameData(null);
      setError("Die Lobby wurde geschlossen.");
    });

    socket.on("disconnect", () => {
      setScreen("menu");
      setLobbyData(null);
      setGameData(null);
    });

    return () => {
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
      if (res.error) setError(res.error);
    });
  };

  const handleJoin = (name, code) => {
    setMyName(name);
    setError("");
    socket.emit("lobby:join", { name, code }, (res) => {
      if (res.error) setError(res.error);
    });
  };

  const handleLeave = () => {
    socket.emit("lobby:leave");
    setScreen("menu");
    setLobbyData(null);
    setGameData(null);
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

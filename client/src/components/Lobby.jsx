import { socket } from "../socket";

export default function Lobby({ lobby, myName, onLeave, onError, error }) {
  const me = lobby.players.find((p) => p.id === socket.id);
  const isHost = me?.isHost;

  const handleStart = () => {
    socket.emit("game:start", (res) => {
      if (res?.error) onError(res.error);
    });
  };

  const handleClose = () => {
    socket.emit("lobby:close");
  };

  return (
    <div className="lobby-container fade-in">
      <div className="lobby-header">
        <h2>Lobby</h2>
        <div className="lobby-code">
          <span className="code-label">Code:</span>
          <span className="code-value">{lobby.code}</span>
        </div>
      </div>

      <div className="player-list">
        <h3>Spieler ({lobby.players.length})</h3>
        {lobby.players.map((p) => (
          <div key={p.id} className={`player-item ${p.id === socket.id ? "player-me" : ""}`}>
            <span className="player-name">
              {p.name}
              {p.isHost && <span className="host-badge">Host</span>}
              {p.id === socket.id && <span className="you-badge">Du</span>}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="error-msg">{error}</p>}

      <div className="lobby-actions">
        {isHost ? (
          <>
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={lobby.players.length < 2}
            >
              {lobby.players.length < 2 ? "Mindestens 2 Spieler" : "Spiel starten"}
            </button>
            <button className="btn btn-danger" onClick={handleClose}>
              Lobby schließen
            </button>
          </>
        ) : (
          <p className="waiting-text">Warte auf den Host...</p>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>
          Verlassen
        </button>
      </div>
    </div>
  );
}

import { useState } from "react";

export default function MainMenu({ onCreateLobby, onJoinLobby, error, clearError }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === "create") {
      onCreateLobby(name.trim());
    } else {
      onJoinLobby(name.trim(), code.trim());
    }
  };

  const handleBack = () => {
    setMode(null);
    setName("");
    setCode("");
    clearError();
  };

  return (
    <div className="menu-container fade-in">
      <div className="logo">
        <span className="logo-icon">?</span>
        <h1>Wer bin ich?</h1>
        <p className="subtitle">Das Ratespiel für Freunde</p>
      </div>

      {!mode ? (
        <div className="menu-buttons">
          <button className="btn btn-primary" onClick={() => { setMode("create"); clearError(); }}>
            Lobby erstellen
          </button>
          <button className="btn btn-secondary" onClick={() => { setMode("join"); clearError(); }}>
            Lobby beitreten
          </button>
        </div>
      ) : (
        <form className="menu-form fade-in" onSubmit={handleSubmit}>
          <h2>{mode === "create" ? "Lobby erstellen" : "Lobby beitreten"}</h2>
          <input
            type="text"
            placeholder="Dein Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus
            required
          />
          {mode === "join" && (
            <input
              type="text"
              placeholder="Lobby-Code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={5}
              required
            />
          )}
          {error && <p className="error-msg">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={handleBack}>
              Zurück
            </button>
            <button type="submit" className="btn btn-primary">
              {mode === "create" ? "Erstellen" : "Beitreten"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

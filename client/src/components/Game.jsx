import { useState } from "react";
import { socket } from "../socket";
import Notepad from "./Notepad";

export default function Game({ game, myName, onLeave }) {
  const [word, setWord] = useState("");
  const [newWordTarget, setNewWordTarget] = useState(null);
  const [newWord, setNewWord] = useState("");
  const [showSolvedModal, setShowSolvedModal] = useState(false);

  const handleSubmitWord = (e) => {
    e.preventDefault();
    socket.emit("game:submitWord", { word: word.trim() }, (res) => {
      if (res?.ok) setWord("");
    });
  };

  const handleSolve = () => {
    socket.emit("game:solve", (res) => {
      if (res?.ok) {
        setShowSolvedModal(true);
      }
    });
  };

  const handleWriteNewWord = (e) => {
    e.preventDefault();
    socket.emit("game:writeNewWord", { targetId: newWordTarget, word: newWord.trim() }, (res) => {
      if (res?.ok) {
        setNewWordTarget(null);
        setNewWord("");
      }
    });
  };

  // Writing phase
  if (game.state === "writing" && game.needsToWrite) {
    return (
      <div className="game-container fade-in">
        <div className="writing-phase">
          <h2>Zettel schreiben</h2>
          <p className="write-for">
            Du schreibst für: <strong>{game.writeForPlayer}</strong>
          </p>
          <form onSubmit={handleSubmitWord}>
            <input
              type="text"
              placeholder="Figur / Person eingeben..."
              value={word}
              onChange={(e) => setWord(e.target.value)}
              maxLength={40}
              autoFocus
              required
            />
            <button type="submit" className="btn btn-primary">
              Abschicken
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Waiting for others to write
  if (game.state === "writing" && !game.needsToWrite) {
    return (
      <div className="game-container fade-in">
        <div className="waiting-phase">
          <div className="spinner" />
          <h2>Warte auf andere Spieler...</h2>
          <p>Dein Zettel wurde abgeschickt!</p>
        </div>
      </div>
    );
  }

  // Playing phase
  return (
    <div className="game-container fade-in">
      <div className="game-header">
        <h2>Wer bin ich?</h2>
        <span className="my-name-tag">{myName}</span>
      </div>

      <div className="players-grid">
        {game.others.map((p) => (
          <div key={p.id} className={`player-card ${p.solved ? "player-solved" : ""}`}>
            <div className="player-card-name">{p.name}</div>
            <div className="player-card-word">
              {p.word || "..."}
            </div>
            {p.solved && (
              <div className="player-card-solved-actions">
                <span className="solved-label">Gelöst!</span>
                <button
                  className="btn btn-small btn-secondary"
                  onClick={() => {
                    setNewWordTarget(p.id);
                    setNewWord("");
                  }}
                >
                  Neues Wort geben
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!game.iSolved ? (
        <button className="btn btn-solve" onClick={handleSolve}>
          Gelöst!
        </button>
      ) : (
        <div className="solved-info">
          <p>
            Dein Wort war: <strong>{game.myWord}</strong>
          </p>
          <p>
            Geschrieben von: <strong>{game.myWordAuthor}</strong>
          </p>
        </div>
      )}

      {showSolvedModal && game.iSolved && (
        <div className="modal-overlay" onClick={() => setShowSolvedModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Richtig geraten!</h3>
            <p className="modal-word">{game.myWord}</p>
            <p className="modal-author">Geschrieben von: {game.myWordAuthor}</p>
            <button className="btn btn-primary" onClick={() => setShowSolvedModal(false)}>
              OK
            </button>
          </div>
        </div>
      )}

      {newWordTarget && (
        <div className="modal-overlay" onClick={() => setNewWordTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Neues Wort vergeben</h3>
            <p>
              Für:{" "}
              <strong>
                {game.others.find((p) => p.id === newWordTarget)?.name}
              </strong>
            </p>
            <form onSubmit={handleWriteNewWord}>
              <input
                type="text"
                placeholder="Neues Wort..."
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                maxLength={40}
                autoFocus
                required
              />
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setNewWordTarget(null)}
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary">
                  Abschicken
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Notepad />

      <button className="btn btn-ghost btn-leave" onClick={onLeave}>
        Spiel verlassen
      </button>
    </div>
  );
}

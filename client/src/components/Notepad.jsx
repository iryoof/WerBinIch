import { useState } from "react";

export default function Notepad() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");

  return (
    <>
      <button
        className={`notepad-toggle ${open ? "notepad-open" : ""}`}
        onClick={() => setOpen(!open)}
        title="Notizblock"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>

      {open && (
        <div className="notepad-panel fade-in">
          <div className="notepad-header">
            <h4>Notizblock</h4>
            <button className="notepad-close" onClick={() => setOpen(false)}>&times;</button>
          </div>
          <textarea
            className="notepad-textarea"
            placeholder="Deine Notizen..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}
    </>
  );
}

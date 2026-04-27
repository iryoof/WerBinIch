# Wer bin ich? - Online Multiplayer

Ein einfaches Browser-basiertes "Wer bin ich?"-Spiel für Freunde.

## Features

- Lobby erstellen & mit Code beitreten
- Host-Steuerung (Spiel starten, Lobby schließen, Host-Status übertragen)
- Zufällige Zulosung der Spieler
- Zettel schreiben & erraten
- "Gelöst"-Funktion mit neuem Wort vergeben
- Persönlicher Notizblock
- Clean & aesthetisches Dark-Theme Design
- Responsive (Desktop & Mobil)

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Node.js + Express + Socket.IO
- **Echtzeit:** WebSocket-basierte Kommunikation

## Lokal starten

```bash
npm run install:all
npm run build
npm start
```

Server startet auf `http://localhost:3001`.

## Auf Render deployen

1. GitHub-Repo erstellen und Code pushen
2. Auf [render.com](https://render.com) anmelden
3. "New Web Service" erstellen
4. GitHub-Repo verbinden
5. Einstellungen:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
6. Deploy klicken - fertig!

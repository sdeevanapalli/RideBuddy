# RideBuddy

RideBuddy helps cyclists discover popular Strava segments and visualize them on a map.

This repository contains two folders:

- `backend` — Express server that proxies Strava API calls (requires STRAVA_ACCESS_TOKEN in `.env`).
- `frontend` — Vite + React + Tailwind app that displays segments using Leaflet.

Quick start

1. Backend

```bash
cd backend
cp .env.example .env
# set STRAVA_ACCESS_TOKEN in .env
npm install
npm run dev
```

2. Frontend (in a new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and click "Find Routes" after panning/zooming the map to your area.

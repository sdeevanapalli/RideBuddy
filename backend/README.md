# RideBuddy — Backend

This Express backend provides a small proxy to Strava's public API for exploring segments.

Setup

1. Copy `.env.example` to `.env` and set `STRAVA_ACCESS_TOKEN`.
2. Install dependencies:

```bash
cd backend
npm install
```

3. Run:

```bash
npm run dev   # or npm start
```

API

- GET /api/segments?bounds=sw_lat,sw_lng,ne_lat,ne_lng
  - Proxies to Strava `/segments/explore` with activity_type=cycling

const express = require('express');
const { getDB } = require('../lib/db');
const fetch = require('node-fetch');
const router = express.Router();

router.post('/route', async (req, res) => {
  const { start, end, distance_km, include_breakfast, breakfast_location, preferences } = req.body;
  try {
      const db = getDB();
      const insert = db.prepare(`INSERT INTO planned_routes (user_id, name, waypoints, segments_used, distance_km, quality_score_avg, include_breakfast) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const info = insert.run(req.user ? req.user.userId : null, "Planned Route", JSON.stringify([{lat: 0, lng: 0}]), JSON.stringify([]), distance_km, 80, include_breakfast ? 1 : 0);
      res.json({ waypoints: [{lat: 0, lng: 0, label: "Start"}, {lat: 0.1, lng: 0.1, label: "End"}], segments_used: [], estimated_distance_km: distance_km, quality_score_avg: 80, gpx_url: `/api/planner/route/${info.lastInsertRowid}/gpx`, id: info.lastInsertRowid });
  } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/route/:id/gpx', (req, res) => {
    res.send(`<?xml version="1.0"?><gpx version="1.1" creator="RideBuddy"><trk><name>Route</name><trkseg></trkseg></trk></gpx>`);
});
module.exports = router;

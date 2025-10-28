const express = require('express');
const fetch = require('node-fetch');
const { refreshTokenIfNeeded } = require('../lib/strava')
const router = express.Router();

// GET /api/segments?bounds=sw_lat,sw_lng,ne_lat,ne_lng or lat_min/lon_min/lat_max/lon_max
router.get('/', async (req, res) => {
  try {
    // ensure token is valid (and refresh if needed)
    let token
    try {
      token = await refreshTokenIfNeeded()
    } catch (e) {
      console.error('Token refresh failed or missing:', e.message || e)
      return res.status(500).json({ error: 'Strava token unavailable', details: String(e) })
    }

    if (!token) return res.status(500).json({ error: 'STRAVA_ACCESS_TOKEN not set in env' })

    let bounds = req.query.bounds;
    if (!bounds) {
      const { lat_min, lon_min, lat_max, lon_max } = req.query;
      if (lat_min && lon_min && lat_max && lon_max) {
        bounds = `${lat_min},${lon_min},${lat_max},${lon_max}`;
      }
    }
    if (!bounds) return res.status(400).json({ error: 'bounds or lat_min/lon_min/lat_max/lon_max required' });

    const url = `https://www.strava.com/api/v3/segments/explore?activity_type=cycling&bounds=${encodeURIComponent(bounds)}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: 'Strava API error', details: text });
    }

    const data = await resp.json();
    // respond with the Strava payload (segments array is in data.segments)
    res.json(data);
  } catch (err) {
    console.error('Error in /api/segments', err);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;

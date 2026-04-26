const express = require('express')
const fetch = require('node-fetch')
const polylineLib = require('@mapbox/polyline')
const { getDB } = require('../lib/db')

const router = express.Router()

// POST /api/planner/route
router.post('/route', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
  
  try {
    const { start, end, distance_km, include_breakfast, breakfast_location, preferences } = req.body
    
    let startLat, startLng
    if (typeof start === 'string') {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(start)}&format=json&limit=1`)
      const data = await resp.json()
      if (!data || !data.length) return res.status(400).json({ error: 'Start location not found' })
      startLat = parseFloat(data[0].lat)
      startLng = parseFloat(data[0].lon)
    } else {
      startLat = start.lat
      startLng = start.lng
    }
    
    let endLat = startLat, endLng = startLng // Loop by default
    if (end) {
      if (typeof end === 'string') {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(end)}&format=json&limit=1`)
        const data = await resp.json()
        if (data && data.length) {
          endLat = parseFloat(data[0].lat)
          endLng = parseFloat(data[0].lon)
        }
      } else {
        endLat = end.lat
        endLng = end.lng
      }
    }

    const db = getDB()
    const segments = db.prepare(`
      SELECT * FROM segments 
      WHERE quality_score IS NOT NULL
      ORDER BY quality_score DESC
    `).all()

    // 1. Fetch segments within 0.2 deg bbox of start point
    const nearby = segments.filter(seg => {
      if (!seg.polyline) return false;
      try {
        const decoded = polylineLib.decode(seg.polyline);
        if (!decoded.length) return false;
        const [slat, slng] = decoded[0];
        return Math.abs(slat - startLat) <= 0.2 && Math.abs(slng - startLng) <= 0.2;
      } catch (e) { return false; }
    });

    let waypoints = [{ lat: startLat, lng: startLng, label: 'Start' }]
    let segments_used = []
    let totalDist = 0
    let totalQuality = 0

    // 2. Build a rough route by chaining nearby high-quality segments
    const targetDist = distance_km || 10
    for (const seg of nearby) {
      if (totalDist >= targetDist) break;
      segments_used.push(seg.strava_id)
      totalDist += (seg.distance / 1000)
      totalQuality += seg.quality_score
    }
    
    // 3. If include_breakfast=true, find a midpoint roughly at distance_km/2 and add a waypoint
    if (include_breakfast && breakfast_location) {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(breakfast_location)}&format=json&limit=1`)
      const data = await resp.json()
      if (data && data.length) {
        waypoints.push({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: 'Breakfast ☕' })
      }
    }

    // Add end waypoint if it is not exactly the start waypoint, or just add it to complete the loop.
    // If it's a loop, we still want to visualize the end.
    waypoints.push({ lat: endLat, lng: endLng, label: 'End' })

    const quality_score_avg = segments_used.length ? (totalQuality / segments_used.length) : 0
    
    const stmt = db.prepare(`
      INSERT INTO planned_routes (user_id, name, waypoints, segments_used, distance_km, quality_score_avg, include_breakfast)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    
    const info = stmt.run(
      req.user.userId, 
      `Planned Route - ${targetDist}km`, 
      JSON.stringify(waypoints), 
      JSON.stringify(segments_used), 
      totalDist, 
      quality_score_avg, 
      include_breakfast ? 1 : 0
    )

    res.json({
      id: info.lastInsertRowid,
      waypoints,
      segments_used,
      estimated_distance_km: totalDist,
      quality_score_avg,
      gpx_url: `/api/planner/route/${info.lastInsertRowid}/gpx`
    })
  } catch (err) {
    console.error('Error planning route:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/planner/route/:id/gpx
router.get('/route/:id/gpx', (req, res) => {
  try {
    const db = getDB()
    const route = db.prepare('SELECT * FROM planned_routes WHERE id = ?').get(req.params.id)
    if (!route) return res.status(404).json({ error: 'Route not found' })

    const waypoints = JSON.parse(route.waypoints || '[]')
    
    let trkpts = ''
    for (const wp of waypoints) {
      trkpts += `      <trkpt lat="${wp.lat}" lon="${wp.lng}"></trkpt>\n`
    }

    const gpx = \`<?xml version="1.0"?>
<gpx version="1.1" creator="RideBuddy">
  <trk><name>\${route.name}</name><trkseg>
\${trkpts}    </trkseg></trk>
</gpx>\`

    res.header('Content-Type', 'application/gpx+xml')
    res.attachment(\`\${route.name.replace(/\\s+/g, '_')}.gpx\`)
    res.send(gpx)
  } catch (err) {
    console.error('Error generating GPX:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

const express = require('express');
const { getDB, getScoredSegments } = require('../lib/db');
const polylineLib = require('@mapbox/polyline');
const fetch = require('node-fetch');
const router = express.Router();

async function geocode(locationStr) {
    if (!locationStr) return null;
    const parts = locationStr.split(',').map(s => s.trim());
    if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
        return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
    }
    try {
        let res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationStr)}&format=json`);
        let json = await res.json();
        if (json && json.length > 0) {
            return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
        }
    } catch(e) { console.error('Geocode err:', e); }
    return null;
}

router.post('/route', async (req, res) => {
  const { start, end, distance_km, include_breakfast, breakfast_location, preferences } = req.body;
  if (!start) return res.status(400).json({ error: 'Start point required' });
  try {
      const db = getDB();
      const stCoords = await geocode(start) || { lat: 0, lng: 0 };
      const stLat = stCoords.lat;
      const stLng = stCoords.lng;

      if (stLat === 0 && stLng === 0) {
          return res.status(400).json({ error: 'Could not resolve start address' });
      }
      
      const segments = getScoredSegments();
      // filter nearby (0.2 degree)
      const nearby = segments.filter(reqSeg => {
         if (!reqSeg.polyline) return false;
         try {
             const sd = polylineLib.decode(reqSeg.polyline);
             if (sd.length === 0) return false;
             let mLat = sd[0][0];
             let mLng = sd[0][1];
             if (Math.abs(mLat - stLat) < 0.2 && Math.abs(mLng - stLng) < 0.2) return true;
         } catch(e){}
         return false;
      });
      nearby.sort((a,b) => b.quality_score - a.quality_score);
      const used = nearby.slice(0, 5);

      let waypoints = [{ lat: stLat, lng: stLng, label: "Start" }];
      let path_coords = [];
      let usedIds = [];
      let totalDist = 0;
      let totalScore = 0;

      // Add a line from Start to the first segment
      if (used.length > 0) {
          const sdFirst = polylineLib.decode(used[0].polyline);
          path_coords.push([stLat, stLng]);
          path_coords.push([sdFirst[0][0], sdFirst[0][1]]);
      }

      for(let i=0; i<used.length; i++) {
          let s = used[i];
          const sd = polylineLib.decode(s.polyline);
          if (sd.length > 0) {
              const mid = sd[Math.floor(sd.length / 2)];
              waypoints.push({ lat: mid[0], lng: mid[1], label: s.name || 'Segment' });
              path_coords.push(...sd);
          }
          usedIds.push(s.id);
          totalDist += s.distance || 0;
          totalScore += s.quality_score || 0;

          // connect to next segment
          if (i < used.length - 1) {
              const sdNext = polylineLib.decode(used[i+1].polyline);
              path_coords.push([sd[sd.length-1][0], sd[sd.length-1][1]]);
              path_coords.push([sdNext[0][0], sdNext[0][1]]);
          }
      }
      
      // End point
      waypoints.push({ lat: stLat + 0.001, lng: stLng + 0.001, label: "End" });
      if (used.length > 0) {
          const sdLast = polylineLib.decode(used[used.length-1].polyline);
          path_coords.push([sdLast[sdLast.length-1][0], sdLast[sdLast.length-1][1]]);
          path_coords.push([stLat + 0.001, stLng + 0.001]);
      } else {
          path_coords.push([stLat, stLng], [stLat + 0.001, stLng + 0.001]);
      }
      
      if (include_breakfast && breakfast_location) {
         let brCoords = await geocode(breakfast_location);
         if (brCoords) {
             waypoints.splice(Math.floor(waypoints.length / 2), 0, { lat: brCoords.lat, lng: brCoords.lng, label: "Breakfast \u2615" });
         }
      }

      const distKm = totalDist > 0 ? totalDist / 1000 : 10;
      const qualityScoreAvg = used.length > 0 ? Math.round(totalScore / used.length) : 80;

      const insert = db.prepare(`INSERT INTO planned_routes (user_id, name, waypoints, segments_used, distance_km, quality_score_avg, include_breakfast) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const info = insert.run(req.user ? req.user.userId : null, "Planned Route", JSON.stringify(waypoints), JSON.stringify(usedIds), distKm, qualityScoreAvg, include_breakfast ? 1 : 0);
      
      res.json({ waypoints, path_coords, segments_used: usedIds, estimated_distance_km: distKm, quality_score_avg: qualityScoreAvg, gpx_url: `/api/planner/route/${info.lastInsertRowid}/gpx`, id: info.lastInsertRowid });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/route/:id/gpx', (req, res) => {
    res.type('application/gpx+xml');
    res.send(`<?xml version="1.0"?><gpx version="1.1" creator="RideBuddy"><trk><name>Route</name><trkseg></trkseg></trk></gpx>`);
});
module.exports = router;

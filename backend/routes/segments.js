const express = require('express')
const fetch = require('node-fetch')
const polylineLib = require('@mapbox/polyline')
const { refreshTokenIfNeeded } = require('../lib/strava')
const { refreshUserToken } = require('../lib/auth')
const {
  upsertSegment,
  getSegments,
  updateSegmentQuality,
  getScoredSegments,
  upsertSegmentPR,
  getSegmentPRsByUser,
  getDB,
} = require('../lib/db')

const router = express.Router()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildQualityGeoJSON(segments) {
  const features = []
  for (const seg of segments) {
    if (!seg.polyline) continue
    try {
      const latlngs = polylineLib.decode(seg.polyline)
      const coordinates = latlngs.map(([lat, lng]) => [lng, lat])
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          strava_id: seg.strava_id,
          name: seg.name,
          quality_score: seg.quality_score != null ? seg.quality_score : null,
          avg_speed: seg.avg_speed != null ? seg.avg_speed : null,
          effort_count: seg.effort_count,
          avg_grade: seg.avg_grade,
          distance: seg.distance,
        },
      })
    } catch (_) {}
  }
  return { type: 'FeatureCollection', features }
}

// GET /api/segments?bounds=sw_lat,sw_lng,ne_lat,ne_lng
// Proxies Strava segments/explore and persists results for quality scoring.
router.get('/', async (req, res) => {
  try {
    let token

    if (req.user && req.user.userId) {
      try {
        token = await refreshUserToken(req.user.userId)
      } catch (e) {
        console.error('User token refresh failed:', e.message || e)
        token = await refreshTokenIfNeeded()
      }
    } else {
      try {
        token = await refreshTokenIfNeeded()
      } catch (e) {
        console.error('Token refresh failed or missing:', e.message || e)
        return res.status(500).json({ error: 'Strava token unavailable', details: String(e) })
      }
    }

    if (!token) return res.status(500).json({ error: 'STRAVA_ACCESS_TOKEN not set in env' })

    let bounds = req.query.bounds
    if (!bounds) {
      const { lat_min, lon_min, lat_max, lon_max } = req.query
      if (lat_min && lon_min && lat_max && lon_max) {
        bounds = `${lat_min},${lon_min},${lat_max},${lon_max}`
      }
    }
    if (!bounds) return res.status(400).json({ error: 'bounds or lat_min/lon_min/lat_max/lon_max required' })

    const url = `https://www.strava.com/api/v3/segments/explore?activity_type=cycling&bounds=${encodeURIComponent(bounds)}`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })

    if (!resp.ok) {
      const text = await resp.text()
      return res.status(resp.status).json({ error: 'Strava API error', details: text })
    }

    const data = await resp.json()

    // Persist segments so quality scoring has data to work with
    for (const seg of data.segments || []) {
      if (seg.id && seg.points) {
        upsertSegment(
          seg.id,
          seg.name || '',
          seg.points,
          seg.avg_grade || 0,
          seg.effort_count || 0,
          seg.distance || 0
        )
      }
    }

    res.json(data)
  } catch (err) {
    console.error('Error in GET /api/segments:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /api/segments/prs
// For each stored segment, fetches the user's best effort and the KOM time from
// Strava, caches results in segment_prs, and returns segments within 15% of KOM.
// Returns cached results immediately on subsequent calls; use ?refresh=true to re-fetch.
router.get('/prs', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const userId = req.user.userId
    const db = getDB()

    // Return cached results unless forced refresh
    if (!req.query.refresh) {
      const cached = getSegmentPRsByUser(userId)
      if (cached.length > 0) {
        const segments = getScoredSegments()
        const results = cached.map((pr) => {
          const seg = segments.find((s) => s.strava_id === pr.segment_id)
          return {
            segment_id: pr.segment_id,
            name: seg?.name ?? 'Unknown segment',
            quality_score: seg?.quality_score ?? null,
            user_best_time: pr.user_best_time,
            kom_time: pr.kom_time,
            gap_pct: pr.gap_pct,
            polyline: seg?.polyline ?? null,
            distance: seg?.distance ?? null,
          }
        })
        return res.json(results)
      }
    }

    const token = await refreshUserToken(userId)
    const segments = getScoredSegments()
    const results = []

    for (const seg of segments) {
      await sleep(200)
      try {
        const effortResp = await fetch(
          `https://www.strava.com/api/v3/segment_efforts?segment_id=${seg.strava_id}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!effortResp.ok) continue
        const efforts = await effortResp.json()
        if (!Array.isArray(efforts) || !efforts.length) continue

        const bestEffort = efforts.reduce((best, e) =>
          e.elapsed_time < best.elapsed_time ? e : best
        )

        await sleep(200)
        const lbResp = await fetch(
          `https://www.strava.com/api/v3/segments/${seg.strava_id}/leaderboard?per_page=1`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!lbResp.ok) continue
        const lb = await lbResp.json()
        if (!lb.entries || !lb.entries.length) continue

        const komTime = lb.entries[0].elapsed_time
        const userBest = bestEffort.elapsed_time
        const gapPct = Math.round(((userBest - komTime) / komTime) * 1000) / 10

        upsertSegmentPR(userId, seg.strava_id, userBest, komTime, gapPct)

        if (gapPct <= 15) {
          results.push({
            segment_id: seg.strava_id,
            name: seg.name,
            quality_score: seg.quality_score,
            user_best_time: userBest,
            kom_time: komTime,
            gap_pct: gapPct,
            polyline: seg.polyline,
            distance: seg.distance,
          })
        }
      } catch (_) {}
    }

    results.sort((a, b) => a.gap_pct - b.gap_pct)
    res.json(results)
  } catch (err) {
    console.error('Error in GET /api/segments/prs:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/segments/quality/cached
// Returns already-scored segments from DB — no Strava API calls.
// Must be registered before /quality to avoid Express treating 'cached' as a path segment.
router.get('/quality/cached', (req, res) => {
  try {
    res.json(buildQualityGeoJSON(getScoredSegments()))
  } catch (err) {
    console.error('Error in GET /api/segments/quality/cached:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/segments/quality
// Fetches Strava leaderboard for each stored segment, computes quality scores,
// persists them, and returns GeoJSON. Requires auth.
// 200ms inter-request delay to respect Strava's 100 req/15min rate limit for
// small segment counts; warn users with many stored segments to spread scoring.
router.get('/quality', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const token = await refreshUserToken(req.user.userId)
    const segments = getSegments()

    const scored = []
    const unscored = []

    for (const seg of segments) {
      let medianSpeed = 5; // fallback 18km/h

      if (seg.effort_count && seg.effort_count >= 5) {
          try {
              const lbResp = await fetch(
                `https://www.strava.com/api/v3/segments/${seg.strava_id}/leaderboard?per_page=10`,
                { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
              )
              await sleep(200)

              if (lbResp.ok) {
                  const lbData = await lbResp.json()
                  const entries = lbData.entries || []
                  if (entries.length > 0) {
                      const speeds = entries.map((e) => e.average_speed).sort((a, b) => a - b)
                      const mid = Math.floor(speeds.length / 2)
                      medianSpeed = speeds.length % 2 === 0 ? (speeds[mid - 1] + speeds[mid]) / 2 : speeds[mid]
                  } else {
                      medianSpeed = seg.avg_grade > 5 ? 3 : (seg.avg_grade < -5 ? 8 : 6);
                  }
              } else {
                  // Fallback for 403 Forbidden on leaderboards without premium
                  medianSpeed = seg.avg_grade > 2 ? 4 : (seg.avg_grade < -2 ? 9 : 5.5 + Math.random()*2);
              }
          } catch(e) {
              medianSpeed = seg.avg_grade > 2 ? 4 : (seg.avg_grade < -2 ? 9 : 5.5 + Math.random()*2);
          }
      } else {
           medianSpeed = seg.avg_grade > 2 ? 4 : (seg.avg_grade < -2 ? 9 : 5.5 + Math.random()*2);
      }

      const rawQuality =
        medianSpeed * 0.6 +
        Math.log((seg.effort_count || 1) + 1) * 0.3 -
        Math.abs(seg.avg_grade || 0) * 0.1

      scored.push({ ...seg, _medianSpeed: medianSpeed, _rawQuality: rawQuality })
    }

    // Normalize scored segments to 0–100
    if (scored.length > 0) {
      const rawValues = scored.map((s) => s._rawQuality)
      const minVal = Math.min(...rawValues)
      const maxVal = Math.max(...rawValues)
      const range = maxVal - minVal || 1

      for (const seg of scored) {
        const normalized = ((seg._rawQuality - minVal) / range) * 100
        updateSegmentQuality(seg.strava_id, normalized, seg._medianSpeed)
        seg.quality_score = normalized
        seg.avg_speed = seg._medianSpeed
      }
    }

    res.json(buildQualityGeoJSON([...scored, ...unscored]))
  } catch (err) {
    console.error('Error in GET /api/segments/quality:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

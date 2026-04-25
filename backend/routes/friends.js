const express = require('express')
const fetch = require('node-fetch')
const polylineLib = require('@mapbox/polyline')
const { refreshUserToken } = require('../lib/auth')
const { getScoredSegments } = require('../lib/db')

const router = express.Router()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// GET /api/friends/routes
// Fetches recent public activities from followed athletes and ranks them by
// recency * 0.4 + avg_quality_of_overlapping_segments * 0.6.
router.get('/routes', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const token = await refreshUserToken(req.user.userId)

    const followingResp = await fetch(
      'https://www.strava.com/api/v3/athlete/following?per_page=10',
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )

    if (!followingResp.ok) return res.json([])

    const following = await followingResp.json()
    if (!Array.isArray(following) || !following.length) return res.json([])

    const scoredSegments = getScoredSegments()
    const allRoutes = []

    for (const athlete of following.slice(0, 10)) {
      await sleep(200)
      try {
        const activitiesResp = await fetch(
          `https://www.strava.com/api/v3/athletes/${athlete.id}/activities?per_page=5`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!activitiesResp.ok) continue
        const activities = await activitiesResp.json()
        if (!Array.isArray(activities)) continue

        for (const act of activities) {
          const encoded = act.map && act.map.summary_polyline
          if (!encoded) continue

          let decoded
          try { decoded = polylineLib.decode(encoded) } catch (_) { continue }

          const lats = decoded.map(([lat]) => lat)
          const lngs = decoded.map(([, lng]) => lng)
          const bbox = {
            minLat: Math.min(...lats), maxLat: Math.max(...lats),
            minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
          }

          const overlapping = scoredSegments.filter((seg) => {
            if (!seg.polyline) return false
            try {
              const sd = polylineLib.decode(seg.polyline)
              const midIdx = Math.floor(sd.length / 2)
              const [midLat, midLng] = sd[midIdx]
              return midLat >= bbox.minLat && midLat <= bbox.maxLat &&
                     midLng >= bbox.minLng && midLng <= bbox.maxLng
            } catch (_) { return false }
          })

          const avgQuality = overlapping.length > 0
            ? overlapping.reduce((s, x) => s + x.quality_score, 0) / overlapping.length
            : 0

          const actDate = act.start_date ? new Date(act.start_date) : null
          const ageMs = actDate ? Date.now() - actDate.getTime() : Infinity
          const recency = Math.max(0, 1 - ageMs / (7 * 24 * 3600 * 1000))
          const rankScore = recency * 0.4 + (avgQuality / 100) * 0.6

          allRoutes.push({
            athlete_id: athlete.id,
            athlete_name: `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim(),
            athlete_avatar: athlete.profile_medium || null,
            activity_id: act.id,
            activity_name: act.name || 'Activity',
            distance: act.distance || 0,
            start_date: act.start_date || null,
            polyline: encoded,
            quality_signal: Math.round(avgQuality),
            rank_score: rankScore,
          })
        }
      } catch (_) {}
    }

    allRoutes.sort((a, b) => b.rank_score - a.rank_score)
    res.json(allRoutes.slice(0, 10))
  } catch (err) {
    console.error('Error in GET /api/friends/routes:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

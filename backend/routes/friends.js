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

    const activitiesResp = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=30',
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )

    if (!activitiesResp.ok) return res.json({ message: "No friend activities found in your Strava feed" })

    const activities = await activitiesResp.json()
    if (!Array.isArray(activities) || !activities.length) {
      return res.json({ message: "No friend activities found in your Strava feed" })
    }

    const scoredSegments = getScoredSegments()
    const allRoutes = []

    for (const act of activities) {
      // If we can determine the athlete is the user, we can optionally skip it.
      // Since the feed might only be user's activities or include friends,
      // we'll process them all, but assume we want to skip user's own if athlete_id is known.
      const athleteId = act.athlete?.id
      if (athleteId && String(athleteId) === String(req.user.userId)) continue

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
        athlete_id: athleteId || 'unknown',
        athlete_name: act.athlete ? `${act.athlete.firstname || ''} ${act.athlete.lastname || ''}`.trim() : 'Friend',
        athlete_avatar: act.athlete?.profile_medium || null,
        activity_id: act.id,
        activity_name: act.name || 'Activity',
        distance: act.distance || 0,
        start_date: act.start_date || null,
        polyline: encoded,
        quality_signal: Math.round(avgQuality),
        rank_score: rankScore,
      })
    }

    if (!allRoutes.length) {
      return res.json({ message: "No friend activities found in your Strava feed" })
    }

    allRoutes.sort((a, b) => b.rank_score - a.rank_score)
    res.json(allRoutes.slice(0, 10))
  } catch (err) {
    console.error('Error in GET /api/friends/routes:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

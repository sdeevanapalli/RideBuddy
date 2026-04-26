const express = require('express')
const fetch = require('node-fetch')
const polyline = require('@mapbox/polyline')
const { refreshUserToken } = require('../lib/auth')
const { upsertActivity, getActivitiesByUser, getActivityStats } = require('../lib/db')

const router = express.Router()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// POST /api/activities/sync
// Paginates through all athlete activities and stores polylines in DB.
// 2-second delay between pages to stay under Strava's 100 req/15min limit.
router.post('/sync', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const token = await refreshUserToken(req.user.userId)
    const userId = req.user.userId

    let page = 1
    let totalSynced = 0
    let pagesFetched = 0

    while (true) {
      const url = `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })

      if (resp.status === 429) {
        return res.status(429).json({ error: 'Strava rate limit reached', synced: totalSynced, pages: pagesFetched })
      }

      if (!resp.ok) {
        const text = await resp.text()
        return res.status(resp.status).json({ error: 'Strava API error', details: text, synced: totalSynced })
      }

      const activities = await resp.json()
      pagesFetched++

      console.log(`[sync] page ${page}: got ${activities.length} activities`)

      if (!activities.length) break

      let pageSynced = 0
      for (const a of activities) {
        const encoded = a.map && a.map.summary_polyline
        if (!encoded) continue
        upsertActivity(userId, a.id, a.name || '', a.start_date || '', encoded, a.distance || 0, a.moving_time || 0)
        totalSynced++
        pageSynced++
      }

      console.log(`[sync] page ${page}: stored ${pageSynced} (with polyline) of ${activities.length}`)

      if (activities.length < 200) break
      page++
      await sleep(2000)
    }

    res.json({ synced: totalSynced, pages: pagesFetched })
  } catch (err) {
    console.error('Error in POST /api/activities/sync:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/activities/coverage
// Returns all stored polylines for the authenticated user as a GeoJSON FeatureCollection.
router.get('/coverage', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const activities = getActivitiesByUser(req.user.userId)

    const features = []
    for (const a of activities) {
      if (!a.polyline) continue
      try {
        // polyline.decode returns [[lat, lng], ...]; GeoJSON needs [lng, lat]
        const latlngs = polyline.decode(a.polyline)
        const coordinates = latlngs.map(([lat, lng]) => [lng, lat])
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { name: a.name, distance: a.distance },
        })
      } catch (_) {
        // skip malformed polylines
      }
    }

    res.json({ type: 'FeatureCollection', features })
  } catch (err) {
    console.error('Error in GET /api/activities/coverage:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/activities/status
// Returns { count, lastSyncedAt } for the authenticated user.
router.get('/status', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const stats = getActivityStats(req.user.userId)
    res.json({ count: stats.count || 0, lastSyncedAt: stats.lastSyncedAt || null })
  } catch (err) {
    console.error('Error in GET /api/activities/status:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

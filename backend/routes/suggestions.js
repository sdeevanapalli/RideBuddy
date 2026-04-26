const express = require('express')
const polylineLib = require('@mapbox/polyline')
const { getDB, getActivitiesByUser } = require('../lib/db')

const router = express.Router()

// GET /api/suggestions
// Returns top 10 high-quality segments not overlapping with the user's ridden routes.
// Proximity check: segment midpoint within 0.1 deg lat/lng of any activity point.
router.get('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const db = getDB()
    const userId = req.user.userId

    const segments = db.prepare(
      'SELECT * FROM segments WHERE quality_score >= 0 AND scored_at IS NOT NULL'
    ).all()

    const activities = getActivitiesByUser(userId)

    const activityPoints = []
    for (const act of activities) {
      if (!act.polyline) continue
      try {
        const decoded = polylineLib.decode(act.polyline)
        for (const pt of decoded) activityPoints.push(pt)
      } catch (_) {}
    }

    const suggestions = []
    for (const seg of segments) {
      if (!seg.polyline) continue
      let decoded
      try { decoded = polylineLib.decode(seg.polyline) } catch (_) { continue }

      const midIdx = Math.floor(decoded.length / 2)
      const [midLat, midLng] = decoded[midIdx]

      const alreadyRidden = activityPoints.some(
        ([lat, lng]) => Math.abs(lat - midLat) <= 0.1 && Math.abs(lng - midLng) <= 0.1
      )

      if (!alreadyRidden) {
        const computedScore = seg.quality_score * 0.7 + Math.log(seg.effort_count + 1) * 10 * 0.3
        let why = 'High quality road'
        if (seg.effort_count > 100) why = 'High traffic, smooth road'
        else if (seg.quality_score >= 85) why = 'Smooth road, great conditions'
        else if (seg.avg_grade && Math.abs(seg.avg_grade) > 3) why = 'Challenging grade, good road'
        else if (seg.effort_count > 50) why = 'Popular route, well maintained'
        suggestions.push({ ...seg, computed_score: computedScore, why })
      }
    }

    suggestions.sort((a, b) => b.computed_score - a.computed_score)
    res.json(suggestions.slice(0, 10))
  } catch (err) {
    console.error('Error in GET /api/suggestions:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

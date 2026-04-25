const express = require('express')
const { getDB } = require('../lib/db')

const router = express.Router()

// GET /api/dashboard/stats
router.get('/stats', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const db = getDB()
    const userId = req.user.userId

    const activityStats = db.prepare(`
      SELECT
        COUNT(*) as total_activities,
        COALESCE(ROUND(SUM(distance) / 1000.0, 1), 0) as total_distance_km,
        COALESCE(ROUND(SUM(moving_time) / 3600.0, 1), 0) as total_moving_time_hrs
      FROM activities WHERE user_id = ?
    `).get(userId)

    const segmentStats = db.prepare(`
      SELECT
        COUNT(*) as total_segments_saved,
        COALESCE(ROUND(AVG(quality_score), 1), 0) as avg_quality_score,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score >= 80 THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_green,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score >= 50 AND quality_score < 80 THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_yellow,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score < 50 AND quality_score IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_red
      FROM segments
    `).get()

    const weeklyDistance = db.prepare(`
      SELECT
        strftime('%Y-%W', start_date) as week,
        ROUND(SUM(distance) / 1000.0, 1) as distance_km
      FROM activities
      WHERE user_id = ? AND start_date >= date('now', '-56 days')
      GROUP BY week
      ORDER BY week ASC
    `).all(userId)

    const topSegments = db.prepare(`
      SELECT strava_id, name, quality_score, distance, avg_grade
      FROM segments
      WHERE quality_score IS NOT NULL
      ORDER BY quality_score DESC
      LIMIT 5
    `).all()

    res.json({
      ...activityStats,
      ...segmentStats,
      weekly_distance: weeklyDistance,
      top_segments: topSegments,
    })
  } catch (err) {
    console.error('Error in GET /api/dashboard/stats:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

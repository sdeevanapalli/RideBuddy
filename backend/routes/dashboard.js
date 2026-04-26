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

    console.log('[dashboard/stats] activityStats:', activityStats)

    const segmentStats = db.prepare(`
      SELECT
        COUNT(*) as total_segments_saved,
        COALESCE(ROUND(AVG(quality_score), 1), 0) as avg_quality_score,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score >= 80 THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_green,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score >= 50 AND quality_score < 80 THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_yellow,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN quality_score < 50 AND quality_score IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(quality_score), 0), 1), 0) as pct_red
      FROM segments
    `).get()

    console.log('[dashboard/stats] segmentStats:', segmentStats)

    // Strava stores start_date as ISO 8601 with a trailing 'Z' (e.g. "2024-04-20T10:30:00Z").
    // SQLite's strftime() does not recognise the Z suffix and returns NULL for such strings,
    // which collapses every row into a single NULL group.  Strip the Z first.
    const weeklyDistance = db.prepare(`
      SELECT
        strftime('%Y-%W', replace(start_date, 'Z', '')) as week,
        ROUND(SUM(distance) / 1000.0, 1) as distance_km
      FROM activities
      WHERE user_id = ? AND replace(start_date, 'Z', '') >= date('now', '-56 days')
      GROUP BY week
      ORDER BY week ASC
    `).all(userId)

    console.log('[dashboard/stats] weeklyDistance rows:', weeklyDistance)

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

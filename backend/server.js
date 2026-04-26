const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { initDB } = require('./lib/db');
const authMiddleware = require('./middleware/auth');
const segmentsRouter = require('./routes/segments');
const authRouter = require('./routes/auth');
const activitiesRouter = require('./routes/activities');
const dashboardRouter = require('./routes/dashboard');
const suggestionsRouter = require('./routes/suggestions');
const friendsRouter = require('./routes/friends');

dotenv.config();

// Initialize database
initDB();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

app.use('/api/segments', segmentsRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/friends', friendsRouter);
app.use('/auth', authRouter);

// Debug endpoint — no auth required, returns raw table counts for diagnosing data-pipeline issues
app.get('/api/debug/summary', (req, res) => {
  try {
    const db = require('./lib/db').getDB()
    const activities = db.prepare('SELECT COUNT(*) as count FROM activities').get()
    const segments = db.prepare('SELECT COUNT(*) as count FROM segments').get()
    const scored = db.prepare('SELECT COUNT(*) as count FROM segments WHERE scored_at IS NOT NULL').get()
    const weeklyBreakdown = db.prepare(`
      SELECT
        strftime('%Y-%W', replace(start_date, 'Z', '')) as week,
        COUNT(*) as rides,
        ROUND(SUM(distance) / 1000.0, 1) as km
      FROM activities
      GROUP BY week
      ORDER BY week DESC
      LIMIT 20
    `).all()
    const recentActivities = db.prepare(`
      SELECT strava_id, name, start_date, distance, moving_time, synced_at
      FROM activities ORDER BY synced_at DESC LIMIT 10
    `).all()
    res.json({
      activities: activities.count,
      segments: segments.count,
      scored_segments: scored.count,
      weekly_breakdown: weeklyBreakdown,
      recent_activities: recentActivities,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RideBuddy backend listening on http://localhost:${PORT}`);
});

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

let db = null

function initDB() {
  const dataDir = path.resolve(__dirname, '..', 'data')

  // Create data directory if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.resolve(dataDir, 'ridebuddy.db')
  db = new Database(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id INTEGER UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id   INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      name        TEXT,
      start_date  TEXT,
      polyline    TEXT,
      distance    REAL,
      moving_time INTEGER,
      synced_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(strava_id, user_id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_id     INTEGER UNIQUE NOT NULL,
      name          TEXT,
      polyline      TEXT,
      avg_grade     REAL,
      effort_count  INTEGER,
      distance      REAL,
      quality_score REAL,
      avg_speed     REAL,
      scored_at     DATETIME
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_prs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      segment_id     INTEGER NOT NULL,
      user_best_time INTEGER,
      kom_time       INTEGER,
      gap_pct        REAL,
      checked_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, segment_id)
    )
  `)

  // Migration: add columns that may be absent in older DBs
  try { db.exec('ALTER TABLE segments ADD COLUMN quality_score REAL') } catch (_) {}
  try { db.exec('ALTER TABLE segments ADD COLUMN avg_speed REAL') } catch (_) {}
  try { db.exec('ALTER TABLE segments ADD COLUMN scored_at DATETIME') } catch (_) {}

  console.log('✅ Database initialized')
  return db
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.')
  }
  return db
}

function getUserByStravaId(stravaId) {
  const stmt = db.prepare('SELECT * FROM users WHERE strava_id = ?')
  return stmt.get(stravaId)
}

function upsertUser(stravaId, accessToken, refreshToken, expiresAt) {
  const user = getUserByStravaId(stravaId)

  if (user) {
    const stmt = db.prepare(`
      UPDATE users
      SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE strava_id = ?
    `)
    stmt.run(accessToken, refreshToken, expiresAt, stravaId)
    return getUserByStravaId(stravaId)
  } else {
    const stmt = db.prepare(`
      INSERT INTO users (strava_id, access_token, refresh_token, expires_at)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(stravaId, accessToken, refreshToken, expiresAt)
    return getUserByStravaId(stravaId)
  }
}

function getUserToken(userId) {
  const stmt = db.prepare('SELECT access_token, refresh_token, expires_at FROM users WHERE id = ?')
  return stmt.get(userId)
}

function getUserById(userId) {
  const stmt = db.prepare('SELECT id, strava_id, created_at FROM users WHERE id = ?')
  return stmt.get(userId)
}

function upsertSegment(stravaId, name, polyline, avgGrade, effortCount, distance) {
  db.prepare(`
    INSERT INTO segments (strava_id, name, polyline, avg_grade, effort_count, distance)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(strava_id) DO UPDATE SET
      name         = excluded.name,
      polyline     = excluded.polyline,
      avg_grade    = excluded.avg_grade,
      effort_count = excluded.effort_count,
      distance     = excluded.distance
  `).run(stravaId, name, polyline, avgGrade, effortCount, distance)
}

function getSegments() {
  return db.prepare('SELECT * FROM segments').all()
}

function updateSegmentQuality(stravaId, qualityScore, avgSpeed) {
  db.prepare(`
    UPDATE segments SET quality_score = ?, avg_speed = ?, scored_at = CURRENT_TIMESTAMP
    WHERE strava_id = ?
  `).run(qualityScore, avgSpeed, stravaId)
}

function getScoredSegments() {
  return db.prepare('SELECT * FROM segments WHERE scored_at IS NOT NULL').all()
}

function upsertActivity(userId, stravaId, name, startDate, polylineData, distance, movingTime) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO activities (strava_id, user_id, name, start_date, polyline, distance, moving_time, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `)
  stmt.run(stravaId, userId, name, startDate, polylineData, distance, movingTime)
}

function getActivitiesByUser(userId) {
  const stmt = db.prepare('SELECT * FROM activities WHERE user_id = ?')
  return stmt.all(userId)
}

function getActivityStats(userId) {
  const stmt = db.prepare(
    'SELECT COUNT(*) as count, MAX(synced_at) as lastSyncedAt FROM activities WHERE user_id = ?'
  )
  return stmt.get(userId)
}

function upsertSegmentPR(userId, segmentId, userBestTime, komTime, gapPct) {
  db.prepare(`
    INSERT INTO segment_prs (user_id, segment_id, user_best_time, kom_time, gap_pct)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, segment_id) DO UPDATE SET
      user_best_time = excluded.user_best_time,
      kom_time       = excluded.kom_time,
      gap_pct        = excluded.gap_pct,
      checked_at     = CURRENT_TIMESTAMP
  `).run(userId, segmentId, userBestTime, komTime, gapPct)
}

function getSegmentPRsByUser(userId) {
  return db.prepare(
    'SELECT * FROM segment_prs WHERE user_id = ? ORDER BY gap_pct ASC'
  ).all(userId)
}

module.exports = {
  initDB,
  getDB,
  getUserByStravaId,
  upsertUser,
  getUserToken,
  getUserById,
  upsertSegment,
  getSegments,
  updateSegmentQuality,
  getScoredSegments,
  upsertActivity,
  getActivitiesByUser,
  getActivityStats,
  upsertSegmentPR,
  getSegmentPRsByUser,
}

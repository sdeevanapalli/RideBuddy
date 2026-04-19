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

  // Create users table if it doesn't exist
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

module.exports = {
  initDB,
  getDB,
  getUserByStravaId,
  upsertUser,
  getUserToken,
  getUserById,
}

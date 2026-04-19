const jwt = require('jsonwebtoken')
const fetch = require('node-fetch')
const { getDB, upsertUser, getUserByStravaId } = require('./db')

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'

async function refreshUserToken(userId) {
  const db = getDB()
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
  const user = stmt.get(userId)

  if (!user) {
    throw new Error('User not found')
  }

  const now = Date.now() / 1000
  // If token is still valid (with 60s buffer), return current token
  if (user.expires_at > now + 60) {
    return user.access_token
  }

  // Need to refresh
  const clientId = process.env.STRAVA_CLIENT_ID || process.env.client_id
  const clientSecret = process.env.STRAVA_CLIENT_SECRET || process.env.client_secret

  if (!clientId || !clientSecret) {
    throw new Error('Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET')
  }

  const body = new URLSearchParams({
    client_id: String(clientId),
    client_secret: String(clientSecret),
    grant_type: 'refresh_token',
    refresh_token: user.refresh_token,
  })

  const resp = await fetch(STRAVA_TOKEN_URL, { method: 'POST', body })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error('Strava token refresh failed: ' + txt)
  }

  const data = await resp.json()

  // Update user in database
  upsertUser(user.strava_id, data.access_token, data.refresh_token, data.expires_at)

  console.log(`🔁 Token refreshed for user ${userId}`)
  return data.access_token
}

async function exchangeCodeForToken(code) {
  const clientId = process.env.STRAVA_CLIENT_ID || process.env.client_id
  const clientSecret = process.env.STRAVA_CLIENT_SECRET || process.env.client_secret

  if (!clientId || !clientSecret) {
    throw new Error('Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET')
  }

  const body = new URLSearchParams({
    client_id: String(clientId),
    client_secret: String(clientSecret),
    code: code,
    grant_type: 'authorization_code',
  })

  const resp = await fetch(STRAVA_TOKEN_URL, { method: 'POST', body })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error('Failed to exchange code for token: ' + txt)
  }

  const data = await resp.json()

  // Store user in database
  const user = upsertUser(
    data.athlete.id,
    data.access_token,
    data.refresh_token,
    data.expires_at
  )

  return user
}

function createJWT(userId) {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET not set')
  }

  return jwt.sign({ userId }, secret, { expiresIn: '30d' })
}

function verifyJWT(token) {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET not set')
  }

  try {
    return jwt.verify(token, secret)
  } catch (err) {
    return null
  }
}

module.exports = {
  refreshUserToken,
  exchangeCodeForToken,
  createJWT,
  verifyJWT,
}

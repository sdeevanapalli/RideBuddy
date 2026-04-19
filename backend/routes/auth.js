const express = require('express')
const { exchangeCodeForToken, createJWT, verifyJWT } = require('../lib/auth')
const { getUserById } = require('../lib/db')

const router = express.Router()

// Generate a random state for CSRF protection
function generateState() {
  return Math.random().toString(36).substring(7)
}

// POST /auth/login
// Returns a JSON response with the Strava OAuth URL
router.post('/login', (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID || process.env.client_id
  if (!clientId) {
    return res.status(500).json({ error: 'STRAVA_CLIENT_ID not set' })
  }

  // Generate state for CSRF protection
  const state = generateState()
  req.session = req.session || {}
  req.session.oauthState = state

  const callbackUrl = process.env.STRAVA_CALLBACK_URL || 'http://localhost:5173/auth/callback'
  const stravaAuthUrl = new URL('https://www.strava.com/oauth/authorize')
  stravaAuthUrl.searchParams.set('client_id', clientId)
  stravaAuthUrl.searchParams.set('response_type', 'code')
  stravaAuthUrl.searchParams.set('redirect_uri', callbackUrl)
  stravaAuthUrl.searchParams.set('approval_prompt', 'force')
  stravaAuthUrl.searchParams.set('scope', 'read,activity:read')
  stravaAuthUrl.searchParams.set('state', state)

  res.json({ authUrl: stravaAuthUrl.toString() })
})

// GET /auth/callback?code=...&state=...
// Exchanges the authorization code for a token and returns a JWT
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query

  if (error) {
    return res.redirect(`http://localhost:5173?error=${error}`)
  }

  if (!code) {
    return res.redirect('http://localhost:5173?error=no_code')
  }

  try {
    // Exchange code for token
    const user = await exchangeCodeForToken(code)

    // Create JWT
    const jwt = createJWT(user.id)

    // Redirect back to frontend with JWT in URL hash
    res.redirect(`http://localhost:5173?jwt=${jwt}&userId=${user.id}`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    res.redirect(`http://localhost:5173?error=${encodeURIComponent(err.message)}`)
  }
})

// GET /auth/me
// Returns the current authenticated user info
router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const user = getUserById(req.user.userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      id: user.id,
      stravaId: user.strava_id,
      createdAt: user.created_at,
    })
  } catch (err) {
    console.error('Error fetching user:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router

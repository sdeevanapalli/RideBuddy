const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')

async function refreshTokenIfNeeded() {
  try {
    const now = Date.now() / 1000
    const expiresAt = process.env.EXPIRES_AT || process.env.expires_at || process.env.STRAVA_EXPIRES_AT
    const currentAccess = process.env.STRAVA_ACCESS_TOKEN

    // If we have an expires_at and it's still valid (with 60s buffer), return current token
    if (expiresAt && Number(expiresAt) > now + 60 && currentAccess) {
      return currentAccess
    }

    // Need to refresh
    const clientId = process.env.STRAVA_CLIENT_ID || process.env.client_id
    const clientSecret = process.env.STRAVA_CLIENT_SECRET || process.env.client_secret
    const refreshToken = process.env.STRAVA_REFRESH_TOKEN || process.env.refresh_token

    if (!clientId || !clientSecret || !refreshToken) {
      // No refresh possible; return current token if present, else throw
      if (currentAccess) return currentAccess
      throw new Error('Missing Strava client_id/client_secret/refresh_token for token refresh')
    }

    const url = 'https://www.strava.com/oauth/token'
    const body = new URLSearchParams({
      client_id: String(clientId),
      client_secret: String(clientSecret),
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken),
    })

    const resp = await fetch(url, { method: 'POST', body })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error('Strava token refresh failed: ' + txt)
    }

    const data = await resp.json()

    // data contains access_token, refresh_token, expires_at
    process.env.STRAVA_ACCESS_TOKEN = data.access_token
    process.env.STRAVA_REFRESH_TOKEN = data.refresh_token
    process.env.EXPIRES_AT = String(data.expires_at)

    // Update backend .env file in-place if it exists (preserve other keys)
    try {
      const envPath = path.resolve(__dirname, '..', '.env')
      let content = ''
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8')
      }

      const lines = content.split(/\r?\n/).filter(() => true)
      const map = {}
      lines.forEach((ln) => {
        if (!ln || ln.trim().startsWith('#')) return
        const idx = ln.indexOf('=')
        if (idx === -1) return
        const k = ln.slice(0, idx)
        const v = ln.slice(idx + 1)
        map[k] = v
      })

      // update keys
      map['STRAVA_ACCESS_TOKEN'] = data.access_token
      map['STRAVA_REFRESH_TOKEN'] = data.refresh_token
      map['EXPIRES_AT'] = String(data.expires_at)

      // Reconstruct .env content (keep existing order where possible)
      const used = new Set()
      const outLines = []
      lines.forEach((ln) => {
        if (!ln || ln.trim().startsWith('#')) {
          outLines.push(ln)
          return
        }
        const idx = ln.indexOf('=')
        if (idx === -1) {
          outLines.push(ln)
          return
        }
        const k = ln.slice(0, idx)
        if (Object.prototype.hasOwnProperty.call(map, k)) {
          outLines.push(`${k}=${map[k]}`)
          used.add(k)
        } else {
          outLines.push(ln)
        }
      })

      // append any new keys not present
      Object.keys(map).forEach((k) => {
        if (!used.has(k)) outLines.push(`${k}=${map[k]}`)
      })

      fs.writeFileSync(envPath, outLines.join('\n'))
    } catch (e) {
      console.error('Failed to persist .env update:', e)
    }

    console.log('🔁 Token refreshed successfully')
    return data.access_token
  } catch (err) {
    // bubble up
    throw err
  }
}

module.exports = { refreshTokenIfNeeded }

const { verifyJWT } = require('../lib/auth')

function authMiddleware(req, res, next) {
  // Extract JWT from Authorization header or cookies
  const authHeader = req.headers.authorization
  let token = null

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt
  }

  if (token) {
    const decoded = verifyJWT(token)
    if (decoded) {
      req.user = decoded
    }
  }

  // Allow missing JWT - fallback to app token
  next()
}

module.exports = authMiddleware

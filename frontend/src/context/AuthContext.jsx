import React, { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Check if JWT exists in localStorage on mount
  useEffect(() => {
    const jwt = localStorage.getItem('jwt')
    const userId = localStorage.getItem('userId')

    if (jwt && userId) {
      setIsAuthenticated(true)
      setUser({ userId })
    }

    setLoading(false)
  }, [])

  // Parse JWT from URL hash (after OAuth callback)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('jwt=')) {
      const params = new URLSearchParams(hash.slice(1))
      const jwt = params.get('jwt')
      const userId = params.get('userId')
      const errorParam = params.get('error')

      if (errorParam) {
        setError(`OAuth error: ${errorParam}`)
        window.history.replaceState({}, document.title, window.location.pathname)
        return
      }

      if (jwt && userId) {
        localStorage.setItem('jwt', jwt)
        localStorage.setItem('userId', userId)
        setIsAuthenticated(true)
        setUser({ userId })
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }
  }, [])

  function logout() {
    localStorage.removeItem('jwt')
    localStorage.removeItem('userId')
    setIsAuthenticated(false)
    setUser(null)
    setError(null)
  }

  async function login() {
    try {
      setError(null)
      const response = await fetch('/auth/login', { method: 'POST' })
      const data = await response.json()

      if (data.authUrl) {
        window.location.href = data.authUrl
      } else {
        setError('Failed to get authentication URL')
      }
    } catch (err) {
      setError(`Login failed: ${err.message}`)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        loading,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

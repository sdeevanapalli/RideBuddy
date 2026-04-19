import React from 'react'
import { useAuth } from '../context/AuthContext'

export default function LoginButton() {
  const { isAuthenticated, login, logout } = useAuth()

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Logged in</span>
        <button
          onClick={logout}
          className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm"
        >
          Logout
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={login}
      className="px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition text-sm"
    >
      Login with Strava
    </button>
  )
}

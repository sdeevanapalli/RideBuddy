import React from 'react'
import { useAuth } from '../context/AuthContext'
import { LogOut } from 'lucide-react'

export default function LoginButton() {
  const { isAuthenticated, login, logout } = useAuth()

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">Logged in</span>
        <button
          onClick={logout}
          className="px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-all duration-200 text-sm flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={login}
      className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover shadow-sm transition-all duration-200 text-sm font-medium"
    >
      Login with Strava
    </button>
  )
}

import React, { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

export default function AuthCallback() {
  const { isAuthenticated, loading, error } = useAuth()

  useEffect(() => {
    if (isAuthenticated && !loading) {
      // Redirect to home after successful authentication
      setTimeout(() => {
        window.location.href = '/'
      }, 500)
    }
  }, [isAuthenticated, loading])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Authentication Failed</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <a href="/" className="text-orange-500 hover:text-orange-600 font-semibold">
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Logging in...</h1>
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
          <p className="text-gray-600">Please wait while we complete your authentication.</p>
        </div>
      </div>
    </div>
  )
}

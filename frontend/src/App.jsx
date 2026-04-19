import React from 'react'
import { AuthProvider } from './context/AuthContext'
import MapView from './components/MapView'
import LoginButton from './components/LoginButton'

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <header className="bg-blue-600 text-white p-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-xl font-semibold">RideBuddy</div>
            <LoginButton />
          </div>
        </header>
        <main className="flex-1">
          <MapView />
        </main>
      </div>
    </AuthProvider>
  )
}

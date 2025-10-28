import React from 'react'
import MapView from './components/MapView'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-600 text-white p-4">
        <div className="max-w-5xl mx-auto text-xl font-semibold">RideBuddy</div>
      </header>
      <main className="flex-1">
        <MapView />
      </main>
    </div>
  )
}

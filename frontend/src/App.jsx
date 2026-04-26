import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import LoginButton from './components/LoginButton'

import { Map } from 'lucide-react'

function NavBar() {
  const location = useLocation()
  const active = (path) => location.pathname === path

  return (
    <header className="bg-dark text-white h-16 flex items-center px-6 flex-shrink-0 shadow-sm">
      <div className="max-w-full w-full flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <div className="bg-brand rounded-lg p-1.5 flex items-center justify-center">
              <Map className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <span className="text-xl font-bold tracking-tight">RideBuddy</span>
          </Link>
          <nav className="flex gap-6 text-sm font-medium">
            <Link
              to="/"
              className={`transition-colors flex items-center gap-2 ${active('/') ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Dashboard
            </Link>
          </nav>
        </div>
        <LoginButton />
      </div>
    </header>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col">
          <NavBar />
          <main className="flex-1 flex flex-col">
            <Routes>
              <Route path="/" element={<Dashboard />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}

import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import LoginButton from './components/LoginButton'

function NavBar() {
  const location = useLocation()
  const active = (path) => location.pathname === path

  return (
    <header className="bg-blue-600 text-white h-16 flex items-center px-4 flex-shrink-0">
      <div className="max-w-full w-full flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold tracking-tight">RideBuddy</span>
          <nav className="flex gap-6 text-sm font-medium">
            <Link
              to="/"
              className={`transition-colors ${active('/') ? 'text-white underline underline-offset-4' : 'text-blue-200 hover:text-white'}`}
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

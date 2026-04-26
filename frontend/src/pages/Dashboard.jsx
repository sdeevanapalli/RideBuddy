import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import MapView from '../components/MapView'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

function authHeaders() {
  const jwt = localStorage.getItem('jwt')
  return jwt ? { Authorization: `Bearer ${jwt}` } : {}
}

function formatTime(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDist(meters) {
  if (!meters) return '—'
  return (meters / 1000).toFixed(1) + ' km'
}

function qualityColor(score) {
  if (score == null) return '#9ca3af'
  if (score >= 80) return '#00c853'
  if (score >= 50) return '#ffb300'
  return '#d50000'
}

function qualityLabel(score) {
  if (score == null) return 'N/A'
  if (score >= 80) return 'Smooth'
  if (score >= 50) return 'Moderate'
  return 'Rough'
}

function QualityBadge({ score }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-white text-xs font-semibold"
      style={{ background: qualityColor(score) }}
    >
      {score != null ? `${Math.round(score)} · ${qualityLabel(score)}` : 'N/A'}
    </span>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
}

function StatCard({ label, value, unit, loading }) {
  return (
    <div className="bg-white rounded-xl shadow p-5 flex flex-col gap-1">
      <div className="text-sm text-gray-500 font-medium">{label}</div>
      {loading
        ? <Skeleton className="h-9 w-28 mt-1" />
        : (
          <div className="text-3xl font-bold text-gray-800">
            {value ?? '—'}
            {unit && <span className="text-base font-normal text-gray-500 ml-1">{unit}</span>}
          </div>
        )}
    </div>
  )
}

const PIE_COLORS = ['#00c853', '#ffb300', '#d50000']

export default function Dashboard() {
  const { isAuthenticated } = useAuth()

  const mapRef = useRef(null)
  const [mapState, setMapState] = useState({
    showCoverage: false, showQuality: false, syncing: false,
    syncStatus: null, syncResult: null, scoringRoads: false,
  })
  const handleMapStateUpdate = useCallback((s) => setMapState(s), [])

  const [activeTab, setActiveTab] = useState('overview')

  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [activityStatus, setActivityStatus] = useState(null)

  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)

  const [prs, setPrs] = useState([])
  const [prsLoading, setPrsLoading] = useState(false)
  const [prsLoaded, setPrsLoaded] = useState(false)

  const [friends, setFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsLoaded, setFriendsLoaded] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    fetchStats()
    fetchSuggestions()
    fetchActivityStatus()
  }, [isAuthenticated])

  useEffect(() => {
    if (mapState.syncResult && !mapState.syncing) {
      fetchActivityStatus()
      fetchStats()
      fetchSuggestions()
    }
  }, [mapState.syncResult, mapState.syncing])

  useEffect(() => {
    if (!isAuthenticated) return
    if (activeTab === 'prs' && !prsLoaded) fetchPrs()
    if (activeTab === 'friends' && !friendsLoaded) fetchFriends()
  }, [activeTab, isAuthenticated])

  async function fetchStats() {
    setStatsLoading(true)
    try {
      const resp = await fetch('/api/dashboard/stats', { headers: authHeaders() })
      if (resp.ok) setStats(await resp.json())
    } finally {
      setStatsLoading(false)
    }
  }

  async function fetchActivityStatus() {
    try {
      const resp = await fetch('/api/activities/status', { headers: authHeaders() })
      if (resp.ok) {
        const data = await resp.json()
        setActivityStatus(data)
        return data
      }
    } catch (_) {}
    return null
  }

  async function fetchSuggestions() {
    setSuggestionsLoading(true)
    try {
      const resp = await fetch('/api/suggestions', { headers: authHeaders() })
      if (resp.ok) setSuggestions(await resp.json())
    } finally {
      setSuggestionsLoading(false)
    }
  }

  async function fetchPrs() {
    setPrsLoading(true)
    try {
      const resp = await fetch('/api/segments/prs', { headers: authHeaders() })
      if (resp.ok) setPrs(await resp.json())
    } finally {
      setPrsLoading(false)
      setPrsLoaded(true)
    }
  }

  async function fetchFriends() {
    setFriendsLoading(true)
    try {
      const resp = await fetch('/api/friends/routes', { headers: authHeaders() })
      if (resp.ok) setFriends(await resp.json())
    } finally {
      setFriendsLoading(false)
      setFriendsLoaded(true)
    }
  }

  async function refreshPrs() {
    setPrsLoading(true)
    try {
      const resp = await fetch('/api/segments/prs?refresh=true', { headers: authHeaders() })
      if (resp.ok) setPrs(await resp.json())
    } finally {
      setPrsLoading(false)
    }
  }

  function showOnMap(polyline, color = 'purple') {
    mapRef.current?.highlight(polyline, color)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center p-8">
        <div className="text-5xl mb-4">🚴</div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Sign in to view your dashboard</h2>
        <p className="text-gray-500 text-sm">Login with Strava to see your stats, suggested routes, and more.</p>
      </div>
    )
  }

  const pieData = stats
    ? [
        { name: 'Smooth', value: stats.pct_green ?? 0 },
        { name: 'Moderate', value: stats.pct_yellow ?? 0 },
        { name: 'Rough', value: stats.pct_red ?? 0 },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div className="max-w-6xl mx-auto w-full p-6 space-y-6">
      {/* Map + Controls */}
      {isAuthenticated && (
        <div className="bg-white rounded-xl shadow flex overflow-hidden" style={{ height: 380 }}>
          <div className="flex-1 min-w-0">
            <MapView ref={mapRef} onStateUpdate={handleMapStateUpdate} />
          </div>
          <div className="w-52 flex-shrink-0 border-l border-gray-100 p-4 flex flex-col gap-3">
            <h3 className="font-semibold text-gray-700 text-sm">Map Controls</h3>
            <button
              onClick={() => mapRef.current?.findRoutes()}
              className="w-full text-left px-3 py-2 rounded-lg text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium"
            >
              Find Routes
            </button>
            <button
              onClick={() => mapRef.current?.toggleQuality()}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mapState.showQuality ? 'bg-green-100 text-green-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {mapState.scoringRoads ? 'Scoring…' : mapState.showQuality ? 'Quality ON' : 'Road Quality'}
            </button>
            <button
              onClick={() => mapRef.current?.toggleCoverage()}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mapState.showCoverage ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {mapState.showCoverage ? 'Coverage ON' : 'My Coverage'}
            </button>
            <button
              onClick={() => mapRef.current?.syncActivities()}
              disabled={mapState.syncing}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              {mapState.syncing ? 'Syncing…' : 'Resync'}
            </button>
            <div className="mt-auto text-xs text-gray-400 space-y-1">
              {mapState.syncStatus?.last_synced && (
                <div>
                  Last sync:{' '}
                  {new Date(mapState.syncStatus.last_synced).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric',
                  })}
                </div>
              )}
              {mapState.syncResult && !mapState.syncing && (
                mapState.syncResult.error
                  ? <div className="text-red-500">Error: {mapState.syncResult.error}</div>
                  : <div className="text-green-600">Synced {mapState.syncResult.synced ?? 0} rides</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'prs', label: 'PRs & KOMs' },
          { id: 'friends', label: 'Friends' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t transition-colors ${
              activeTab === id
                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px bg-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Distance"
              value={stats?.total_distance_km != null ? Number(stats.total_distance_km).toFixed(0) : undefined}
              unit="km"
              loading={statsLoading}
            />
            <StatCard label="Total Rides" value={stats?.total_activities} loading={statsLoading} />
            <StatCard
              label="Moving Time"
              value={stats?.total_moving_time_hrs != null ? Number(stats.total_moving_time_hrs).toFixed(1) : undefined}
              unit="hrs"
              loading={statsLoading}
            />
            <StatCard label="Segments Saved" value={stats?.total_segments_saved} loading={statsLoading} />
          </div>

          {/* Sync status indicator */}
          {activityStatus && (
            <div className="flex items-center gap-2 text-xs text-gray-400 -mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              <span>
                Last synced: <span className="font-medium text-gray-600">{activityStatus.count} activities</span>
                {activityStatus.lastSyncedAt && (
                  <> · {new Date(activityStatus.lastSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </span>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow p-5">
              <h3 className="font-semibold text-gray-700 mb-4">Weekly Distance (last 8 weeks)</h3>
              {statsLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : stats?.weekly_distance?.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={stats.weekly_distance} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis unit="km" tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => [`${v} km`, 'Distance']} />
                    <Bar dataKey="distance_km" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                  No activity data. Sync your rides from the Map view.
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow p-5">
              <h3 className="font-semibold text-gray-700 mb-4">Road Quality Distribution</h3>
              {statsLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="45%"
                      outerRadius={65}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v}%`]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                  No scored segments. Click "Road Quality" on the Map.
                </div>
              )}
            </div>
          </div>

          {/* Top segments table */}
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="font-semibold text-gray-700 mb-4">Top Segments by Quality</h3>
            {statsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : stats?.top_segments?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs uppercase tracking-wide border-b">
                    <th className="pb-2 font-medium">Segment</th>
                    <th className="pb-2 font-medium">Quality</th>
                    <th className="pb-2 font-medium">Distance</th>
                    <th className="pb-2 font-medium">Avg Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top_segments.map((seg) => (
                    <tr key={seg.strava_id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="py-3 font-medium text-gray-800">{seg.name}</td>
                      <td className="py-3"><QualityBadge score={seg.quality_score} /></td>
                      <td className="py-3 text-gray-500">{formatDist(seg.distance)}</td>
                      <td className="py-3 text-gray-500">{seg.avg_grade != null ? `${seg.avg_grade}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center text-gray-400 py-8 text-sm">
                No scored segments yet. Click "Road Quality" on the Map to start scoring.
              </div>
            )}
          </div>

          {/* Suggestions */}
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="font-semibold text-gray-700 mb-1">Suggested Routes</h3>
            <p className="text-xs text-gray-400 mb-4">High-quality segments you haven't ridden yet</p>
            {suggestionsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
              </div>
            ) : suggestions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.map((seg) => (
                  <div key={seg.strava_id} className="border border-gray-100 rounded-lg p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="font-medium text-gray-800 text-sm leading-snug">{seg.name}</div>
                      <QualityBadge score={seg.quality_score} />
                    </div>
                    <div className="flex gap-3 text-xs text-gray-400 mb-3">
                      <span>{formatDist(seg.distance)}</span>
                      {seg.avg_grade != null && <span>{seg.avg_grade}% grade</span>}
                      <span>{seg.effort_count?.toLocaleString()} efforts</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full">
                        {seg.why}
                      </span>
                      {seg.polyline && (
                        <button
                          onClick={() => showOnMap(seg.polyline, 'purple')}
                          className="text-xs text-blue-600 hover:underline ml-2 whitespace-nowrap"
                        >
                          Show on Map →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8 text-sm">
                No suggestions found. Sync activities and score road quality first, then check back.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PRs & KOMs ──────────────────────────────────────────────────────────── */}
      {activeTab === 'prs' && (
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-700">Near-KOM Segments</h3>
            <button
              onClick={refreshPrs}
              disabled={prsLoading}
              className="text-xs text-blue-600 hover:underline disabled:opacity-40"
            >
              {prsLoading ? 'Fetching…' : 'Refresh from Strava'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Segments where your best effort is within 15% of the KOM time
            {!prsLoaded && ' · First load fetches live Strava data and may take a moment'}
          </p>

          {prsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : prs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs uppercase tracking-wide border-b">
                    <th className="pb-2 font-medium">Segment</th>
                    <th className="pb-2 font-medium">Your Best</th>
                    <th className="pb-2 font-medium">KOM</th>
                    <th className="pb-2 font-medium">Gap</th>
                    <th className="pb-2 font-medium">Quality</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {prs.map((pr) => {
                    const gapBg =
                      pr.gap_pct <= 5 ? '#00c853' :
                      pr.gap_pct <= 10 ? '#ffb300' : '#ff6d00'
                    return (
                      <tr key={pr.segment_id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="py-3 font-medium text-gray-800 pr-4">{pr.name}</td>
                        <td className="py-3 text-gray-600 font-mono">{formatTime(pr.user_best_time)}</td>
                        <td className="py-3 text-gray-600 font-mono">{formatTime(pr.kom_time)}</td>
                        <td className="py-3">
                          <span
                            className="inline-block px-2 py-0.5 rounded text-white text-xs font-semibold"
                            style={{ background: gapBg }}
                          >
                            +{pr.gap_pct}%
                          </span>
                        </td>
                        <td className="py-3"><QualityBadge score={pr.quality_score} /></td>
                        <td className="py-3 text-right">
                          {pr.polyline && (
                            <button
                              onClick={() => showOnMap(pr.polyline, 'orange')}
                              className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                            >
                              Target →
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : prsLoaded ? (
            <div className="text-center text-gray-400 py-12 text-sm">
              No near-KOM segments found. Score road quality on the Map to find more segments,
              then click "Refresh from Strava" above.
            </div>
          ) : null}
        </div>
      )}

      {/* ── FRIENDS ─────────────────────────────────────────────────────────────── */}
      {activeTab === 'friends' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-700">Friends' Recent Routes</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Ranked by recency · quality signal · public activities only
                {!friendsLoaded && ' · Loading from Strava…'}
              </p>
            </div>
          </div>

          {friendsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : friends.length > 0 ? (
            friends.map((route) => (
              <div key={route.activity_id} className="bg-white rounded-xl shadow p-4 flex items-center gap-4">
                {route.athlete_avatar ? (
                  <img
                    src={route.athlete_avatar}
                    alt={route.athlete_name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                    {route.athlete_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800 text-sm">{route.athlete_name}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-600 text-sm truncate">{route.activity_name}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-400 mt-1">
                    <span>{formatDist(route.distance)}</span>
                    {route.start_date && (
                      <span>{new Date(route.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {route.quality_signal > 0 && <QualityBadge score={route.quality_signal} />}
                  {route.polyline && (
                    <button
                      onClick={() => showOnMap(route.polyline, 'orange')}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Show on Map →
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : friendsLoaded ? (
            <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">
              No friend routes found. This may be because your Strava friends have private activities,
              or you're not following anyone with public activities.
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

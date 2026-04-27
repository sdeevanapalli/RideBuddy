import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../context/AuthContext'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'
import { X, Navigation, MapPin, Coffee, Download, Save } from 'lucide-react'

// Fix Leaflet's default marker icon path issue in React/Vite
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})
L.Marker.prototype.options.icon = DefaultIcon

const savedKey = 'ridebuddy_saved_routes'

function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0
  const coords = []
  while (index < str.length) {
    let b, shift = 0, result = 0
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    coords.push([lat / 1e5, lng / 1e5])
  }
  return coords
}

function qualityColor(score) {
  if (score === null || score === undefined) return '#64748b'
  if (score >= 80) return '#00c853'
  if (score >= 50) return '#ffb300'
  return '#d50000'
}

function qualityLabel(score) {
  if (score === null || score === undefined) return 'No data'
  if (score >= 80) return 'Smooth'
  if (score >= 50) return 'Moderate'
  return 'Rough'
}

// FitBounds component calculates bounds around visible routes and auto-fits
function FitBounds({ segments, highlightData }) {
  const map = useMap()
  
  useEffect(() => {
    const latlngs = []
    
    if (highlightData) {
      latlngs.push(...highlightData.coords)
    } else if (segments && segments.length > 0) {
      segments.forEach(s => {
        if (s.start_latlng) latlngs.push(s.start_latlng)
        if (s.end_latlng) latlngs.push(s.end_latlng)
      })
    }

    if (latlngs.length > 0) {
      try {
        const bounds = L.latLngBounds(latlngs)
        map.fitBounds(bounds, { padding: [50, 50] })
      } catch (err) {
        console.warn("Could not fit bounds", err)
      }
    }
  }, [map, segments, highlightData])
  
  return null
}

const MapView = forwardRef(function MapView({ onStateUpdate }, ref) {
  const { isAuthenticated } = useAuth()
  
  // Expose map instance for things like getBounds() 
  const [mapInstance, setMapInstance] = useState(null)

  const [segments, setSegments] = useState([])
  const [coverageData, setCoverageData] = useState(null)
  const [qualityData, setQualityData] = useState(null)
  const [highlightData, setHighlightData] = useState(null)

  const [showCoverage, setShowCoverage] = useState(false)
  const [coverageLoaded, setCoverageLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [showQuality, setShowQuality] = useState(false)
  const [qualityLoaded, setQualityLoaded] = useState(false)
  const [scoringRoads, setScoringRoads] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [useColors, setUseColors] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  // Planner state
  const [showPlanner, setShowPlanner] = useState(false)
  const [plannerState, setPlannerState] = useState({
    start: '', end: '', distance_km: 10, include_breakfast: false, breakfast_location: '', preferences: []
  })
  const [planningMode, setPlanningMode] = useState(false)
  const [plannedRoute, setPlannedRoute] = useState(null)

  // Stable ref avoids the onStateUpdate callback being a useEffect dependency
  const onStateUpdateRef = useRef(onStateUpdate)
  useEffect(() => { onStateUpdateRef.current = onStateUpdate }, [onStateUpdate])

  // Push state to Dashboard whenever relevant values change
  useEffect(() => {
    onStateUpdateRef.current?.({
      showCoverage, showQuality, syncing, syncStatus, syncResult, scoringRoads, useColors, lastUpdate
    })
  }, [showCoverage, showQuality, syncing, syncStatus, syncResult, scoringRoads, useColors, lastUpdate])

  useEffect(() => {
    if (isAuthenticated) {
      fetchSyncStatus().then((status) => {
        if (status && status.count === 0) {
          syncActivities()
        }
      })
    }
  }, [isAuthenticated])

  // Consume any highlight queued via sessionStorage
  useEffect(() => {
    if (!mapReady) return
    const raw = sessionStorage.getItem('ridebuddy_highlight')
    if (!raw) return
    sessionStorage.removeItem('ridebuddy_highlight')
    try {
      const { polyline: encoded, color } = JSON.parse(raw)
      highlight(encoded, color)
    } catch (_) {}
  }, [mapReady])

  // Auto-fit bounds for planned route
  useEffect(() => {
    if (plannedRoute && mapInstance) {
      const latlngs = plannedRoute.waypoints.map(wp => [wp.lat, wp.lng])
      if (latlngs.length > 0) {
        try { mapInstance.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] }) } catch (_) {}
      }
    }
  }, [plannedRoute, mapInstance])

  // Ensure client-side only render wrapper
  const [isClient, setIsClient] = useState(false)
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (mapInstance && !mapReady) {
      setMapReady(true)
      mapInstance.locate({ setView: false, maxZoom: 13, timeout: 5000 }).on('locationerror', (err) => {
        console.warn('Geolocation failed or denied:', err.message)
      })
    }
  }, [mapInstance, mapReady])

  useImperativeHandle(ref, () => ({
    findRoutes,
    toggleCoverage,
    toggleQuality,
    syncActivities,
    highlight,
    toggleColors: () => setUseColors(prev => !prev),
    openPlanner: () => setShowPlanner(true)
  }))

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function authHeaders() {
    const jwt = localStorage.getItem('jwt')
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  function getBoundsString() {
    if (!mapInstance) return null
    const b = mapInstance.getBounds()
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`
  }

  // ── Map actions ───────────────────────────────────────────────────────────────

  async function findRoutes() {
    const bounds = getBoundsString()
    if (!bounds) return
    const resp = await fetch(`/api/segments?bounds=${encodeURIComponent(bounds)}`, {
      headers: authHeaders(),
    })
    if (!resp.ok) { alert('Error fetching segments: ' + (await resp.text())); return }
    const data = await resp.json()
    setSegments(data.segments || [])
    
    // Auto-score so the dashboard populated immediately
    setScoringRoads(true)
    await loadQuality(!isAuthenticated)
    setScoringRoads(false)
    setLastUpdate(Date.now())
  }

  function handleSaveSegment(seg) {
    const saved = JSON.parse(localStorage.getItem(savedKey) || '[]')
    if (!saved.find((r) => String(r.id) === String(seg.id))) {
      saved.push({ id: seg.id, name: seg.name, distance: seg.distance, start: seg.start_latlng })
      localStorage.setItem(savedKey, JSON.stringify(saved))
      alert('Saved: ' + seg.name)
    } else {
      alert('Already saved')
    }
  }

  // ── Planner ──────────────────────────────────────────────────────────────────

  function handleUseMyLocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setPlannerState(prev => ({ ...prev, start: `${position.coords.latitude}, ${position.coords.longitude}` }))
      }, (err) => {
        alert('Could not get location: ' + err.message)
      })
    }
  }

  function handlePreferenceToggle(pref) {
    setPlannerState(prev => {
      const prefs = prev.preferences.includes(pref)
        ? prev.preferences.filter(p => p !== pref)
        : [...prev.preferences, pref]
      return { ...prev, preferences: prefs }
    })
  }

  async function handlePlanRoute(e) {
    e.preventDefault()
    if (!plannerState.start) {
      alert('Please enter a start point')
      return
    }
    setPlanningMode(true)
    try {
      const resp = await fetch('/api/planner/route', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(plannerState)
      })
      if (!resp.ok) throw new Error(await resp.text())
      const data = await resp.json()
      setPlannedRoute(data)
      setShowPlanner(false)
      setPlannerState({
        start: '', end: '', distance_km: 10, include_breakfast: false, breakfast_location: '', preferences: []
      })
    } catch (err) {
      alert('Error planning route: ' + err.message)
    } finally {
      setPlanningMode(false)
    }
  }

  function handleSavePlannedRoute() {
    if (!plannedRoute) return
    const saved = JSON.parse(localStorage.getItem(savedKey) || '[]')
    const routeId = `planned-${plannedRoute.id || Date.now()}`
    if (!saved.find((r) => r.id === routeId)) {
      saved.push({ id: routeId, name: `Planned Route ${plannedRoute.estimated_distance_km.toFixed(1)}km`, distance: plannedRoute.estimated_distance_km * 1000, start: [plannedRoute.waypoints[0].lat, plannedRoute.waypoints[0].lng] })
      localStorage.setItem(savedKey, JSON.stringify(saved))
      alert('Route saved successfully!')
    } else {
      alert('Already saved')
    }
  }

  // ── Coverage ─────────────────────────────────────────────────────────────────

  async function fetchSyncStatus() {
    try {
      const resp = await fetch('/api/activities/status', { headers: authHeaders() })
      if (resp.ok) {
        const data = await resp.json()
        setSyncStatus(data)
        return data
      }
    } catch (_) {}
    return null
  }

  async function loadCoverage() {
    try {
      const resp = await fetch('/api/activities/coverage', { headers: authHeaders() })
      if (!resp.ok) return
      const geojson = await resp.json()
      const coveragePolys = geojson.features
        .filter(f => f.geometry.type === 'LineString')
        .map(f => ({
          id: Math.random().toString(), // Use Math.random if no ID is present
          coords: f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        }))
      setCoverageData(coveragePolys)
      setCoverageLoaded(true)
    } catch (_) {}
  }

  async function toggleCoverage() {
    if (!showCoverage) {
      if (!coverageLoaded) await loadCoverage()
      setShowCoverage(true)
    } else {
      setShowCoverage(false)
    }
  }

  async function syncActivities() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const resp = await fetch('/api/activities/sync', { method: 'POST', headers: authHeaders() })
      const data = await resp.json()
      setSyncResult(data)
      await fetchSyncStatus()
      if (showCoverage) {
        setCoverageLoaded(false)
        setCoverageData(null)
        await loadCoverage()
      }
    } catch (err) {
      setSyncResult({ error: err.message })
    } finally {
      setSyncing(false)
    }
  }

  // ── Quality ───────────────────────────────────────────────────────────────────

  async function loadQuality(useCache) {
    const endpoint = useCache ? '/api/segments/quality/cached' : '/api/segments/quality'
    try {
      const geojson = await fetch(endpoint, { headers: authHeaders() }).then((r) => r.json())
      const qualityPolys = (geojson.features || [])
        .filter(f => f.geometry.type === 'LineString')
        .map(f => ({
          id: f.properties.id || Math.random().toString(),
          coords: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          properties: f.properties
        }))
      setQualityData(qualityPolys)
      setQualityLoaded(true)
    } catch (_) {}
  }

  async function toggleQuality() {
    if (!showQuality) {
      if (!qualityLoaded) {
        setScoringRoads(true)
        await loadQuality(!isAuthenticated)
        setScoringRoads(false)
        setLastUpdate(Date.now())
      }
      setShowQuality(true)
    } else {
      setShowQuality(false)
    }
  }

  // ── Highlight ─────────────────────────────────────────────────────────────────

  function highlight(encoded, color) {
    try {
      const latlngs = decodePolyline(encoded)
      if (!latlngs.length) return
      const colorHex = color === 'purple' ? '#9333ea' : '#f97316'
      setHighlightData({ coords: latlngs, color: colorHex })
    } catch (_) {}
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!isClient) return null

  return (
    <div className="relative w-full h-full">
      <MapContainer 
        center={[17.3850, 78.4867]} 
        zoom={12} 
        className="w-full h-full rounded-lg overflow-hidden shadow-lg z-0"
        ref={setMapInstance}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={useColors ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"}
        />

        <FitBounds 
          segments={segments} 
          coverageData={coverageData} 
          qualityData={qualityData} 
          highlightData={highlightData}
          showCoverage={showCoverage}
          showQuality={showQuality}
        />

        {/* Coverage Layer */}
        {showCoverage && coverageData?.map((c, i) => (
          <Polyline key={`cov-${i}`} positions={c.coords} pathOptions={{ color: "#3b82f6", opacity: 0.5, weight: 2 }} />
        ))}

        {/* Quality Layer */}
        {showQuality && qualityData?.map((q, i) => {
          const { name, quality_score, avg_speed, effort_count, avg_grade, distance } = q.properties
          const color = qualityColor(quality_score)
          const distKm = distance ? (distance / 1000).toFixed(2) : '?'
          const speedKmh = avg_speed ? (avg_speed * 3.6).toFixed(1) : 'N/A'
          const scoreStr = quality_score != null
            ? `${quality_score.toFixed(0)}/100 (${qualityLabel(quality_score)})`
            : 'N/A'
            
          return (
            <Polyline key={`qual-${i}`} positions={q.coords} pathOptions={{ color, weight: 4, opacity: 0.8 }}>
              <Popup>
                <div style={{ minWidth: '190px', fontFamily: 'sans-serif' }}>
                  <strong className="text-gray-900">{name || 'Segment'}</strong><br/>
                  <span className="text-gray-600">Quality:</span> {scoreStr}<br/>
                  <span className="text-gray-600">Median speed:</span> {speedKmh} km/h<br/>
                  <span className="text-gray-600">Efforts:</span> {effort_count ?? 'N/A'}<br/>
                  <span className="text-gray-600">Avg grade:</span> {avg_grade != null ? avg_grade + '%' : 'N/A'}<br/>
                  <span className="text-gray-600">Distance:</span> {distKm} km
                </div>
              </Popup>
            </Polyline>
          )
        })}

        {/* Segments Layer */}
        {segments?.map((s, i) => {
          if (!s.start_latlng || !s.end_latlng) return null
          const distKm = (s.distance / 1000).toFixed(2)
          return (
            <React.Fragment key={`seg-${s.id || i}`}>
              <Polyline positions={[s.start_latlng, s.end_latlng]} pathOptions={{ color: "#2563eb", weight: 4 }} />
              <Marker position={s.start_latlng}>
                <Popup>
                  <div style={{ minWidth: '200px', fontFamily: 'sans-serif' }}>
                    <strong className="text-gray-900">{s.name}</strong><br/>
                    <span className="text-gray-600">Distance:</span> {distKm} km<br/>
                    <span className="text-gray-600">Avg grade:</span> {s.avg_grade}%<br/>
                    <span className="text-gray-600">Efforts:</span> {s.effort_count || s.efforts || 'N/A'}<br/>
                    <button 
                      onClick={() => handleSaveSegment(s)}
                      className="mt-2 w-full px-3 py-1.5 bg-brand text-white rounded hover:bg-brand-hover transition-colors text-sm font-medium"
                    >
                      Save route
                    </button>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          )
        })}

        {/* Highlight Layer */}
        {highlightData && (
          <Polyline positions={highlightData.coords} pathOptions={{ color: highlightData.color, weight: 5, opacity: 0.9 }} />
        )}

        {/* Planned Route Layer */}
        {plannedRoute && (
          <>
            <Polyline 
              positions={plannedRoute.path_coords || plannedRoute.waypoints.map(wp => [wp.lat, wp.lng])} 
              pathOptions={{ color: '#ec4899', weight: 4, dashArray: '8, 8' }} 
            />
            {plannedRoute.waypoints.map((wp, i) => (
              <Marker key={`wp-${i}`} position={[wp.lat, wp.lng]}>
                <Popup>
                  <strong className="text-gray-900">{wp.label}</strong>
                </Popup>
              </Marker>
            ))}
          </>
        )}
      </MapContainer>

      {/* Planned Route Summary Card */}
      {plannedRoute && !showPlanner && (
        <div className="absolute top-3 right-3 bg-white p-4 rounded-xl shadow-lg z-[1000] w-64 border border-gray-100">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-gray-900">Your Route</h3>
            <button onClick={() => setPlannedRoute(null)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1 text-sm text-gray-600 mb-4">
            <div className="flex justify-between">
              <span>Distance</span>
              <span className="font-medium text-gray-900">{plannedRoute.estimated_distance_km.toFixed(1)} km</span>
            </div>
            <div className="flex justify-between">
              <span>Quality Score</span>
              <span className="font-medium text-gray-900">{plannedRoute.quality_score_avg ? plannedRoute.quality_score_avg.toFixed(0) : 'N/A'}/100</span>
            </div>
            <div className="flex justify-between">
              <span>Segments</span>
              <span className="font-medium text-gray-900">{plannedRoute.segments_used?.length || 0}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <a 
              href={plannedRoute.gpx_url}
              download
              className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download GPX
            </a>
            <button 
              onClick={handleSavePlannedRoute}
              className="w-full flex items-center justify-center gap-2 py-2 bg-brand/10 text-brand rounded-lg text-sm font-medium hover:bg-brand/20 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save Route
            </button>
          </div>
        </div>
      )}

      {/* Planner Modal */}
      {showPlanner && (
        <div className="absolute inset-0 z-[2000] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-full">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-brand" />
                Plan a Route
              </h2>
              <button onClick={() => setShowPlanner(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <form onSubmit={handlePlanRoute} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start Point</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <MapPin className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        required
                        value={plannerState.start}
                        onChange={(e) => setPlannerState({...plannerState, start: e.target.value})}
                        placeholder="Address or lat,lng"
                        className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-shadow"
                      />
                    </div>
                    <button type="button" onClick={handleUseMyLocation} className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap">
                      Use Location
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End Point (Optional)</label>
                  <div className="relative">
                    <MapPin className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" />
                    <input 
                      type="text" 
                      value={plannerState.end}
                      onChange={(e) => setPlannerState({...plannerState, end: e.target.value})}
                      placeholder="Leave empty for a loop"
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-shadow"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-700">Distance</label>
                    <span className="text-xs font-semibold text-brand">{plannerState.distance_km} km</span>
                  </div>
                  <input 
                    type="range" 
                    min="5" max="150" step="5"
                    value={plannerState.distance_km}
                    onChange={(e) => setPlannerState({...plannerState, distance_km: parseInt(e.target.value)})}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
                    <span>5km</span>
                    <span>150km</span>
                  </div>
                </div>

                <div className="p-3 bg-orange-50/50 rounded-xl border border-orange-100">
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer">
                      <Coffee className="w-4 h-4 text-orange-500" />
                      Add a breakfast stop?
                    </label>
                    <button 
                      type="button"
                      onClick={() => setPlannerState({...plannerState, include_breakfast: !plannerState.include_breakfast})}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${plannerState.include_breakfast ? 'bg-orange-500' : 'bg-gray-200'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${plannerState.include_breakfast ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  {plannerState.include_breakfast && (
                    <input 
                      type="text" 
                      required
                      value={plannerState.breakfast_location}
                      onChange={(e) => setPlannerState({...plannerState, breakfast_location: e.target.value})}
                      placeholder="e.g. Jubilee Hills, Cafe"
                      className="w-full px-3 py-1.5 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent mt-1"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Preferences</label>
                  <div className="flex flex-wrap gap-2">
                    {['Flat', 'Scenic', 'Avoid traffic'].map(pref => (
                      <button
                        key={pref}
                        type="button"
                        onClick={() => handlePreferenceToggle(pref)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors border ${
                          plannerState.preferences.includes(pref)
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {pref}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={planningMode}
                  className="w-full mt-2 py-2.5 bg-brand text-white rounded-lg font-medium text-sm hover:bg-brand-hover transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {planningMode ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Planning your ride...
                    </>
                  ) : (
                    'Plan Route'
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Quality Legend */}
      {showQuality && (
        <div className="absolute bottom-3 right-3 bg-white p-3 rounded-lg shadow-md text-xs z-[1000]">
          <div className="font-semibold mb-1.5 text-gray-900">Road Quality</div>
          {[
            { color: '#00c853', label: 'Smooth', range: '80–100' },
            { color: '#ffb300', label: 'Moderate', range: '50–79' },
            { color: '#d50000', label: 'Rough', range: '0–49' },
            { color: '#64748b', label: 'No data', range: '' },
          ].map(({ color, label, range }) => (
            <div key={label} className="flex items-center gap-1.5 mb-1">
              <span className="inline-block rounded" style={{ width: 16, height: 4, background: color }} />
              <span className="text-gray-700">
                {label}
                {range && <span className="text-gray-400 ml-1">({range})</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default MapView

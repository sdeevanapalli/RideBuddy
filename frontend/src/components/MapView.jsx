import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../context/AuthContext'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'

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
  if (score === null || score === undefined) return '#9ca3af'
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
    toggleColors: () => setUseColors(prev => !prev)
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
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
          <Polyline key={`cov-${i}`} positions={c.coords} pathOptions={{ color: useColors ? '#3b82f6' : '#ffffff', opacity: 0.5, weight: 2 }} />
        ))}

        {/* Quality Layer */}
        {showQuality && qualityData?.map((q, i) => {
          const { name, quality_score, avg_speed, effort_count, avg_grade, distance } = q.properties
          const color = useColors ? qualityColor(quality_score) : '#ffffff'
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
              <Polyline positions={[s.start_latlng, s.end_latlng]} pathOptions={{ color: useColors ? '#2563eb' : '#ffffff', weight: 4 }} />
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
          <Polyline positions={highlightData.coords} pathOptions={{ color: useColors ? highlightData.color : '#ffffff', weight: 5, opacity: 0.9 }} />
        )}
      </MapContainer>

      {/* Quality Legend */}
      {showQuality && useColors && (
        <div className="absolute bottom-3 right-3 bg-white p-3 rounded-lg shadow-md text-xs z-[1000]">
          <div className="font-semibold mb-1.5 text-gray-900">Road Quality</div>
          {[
            { color: '#00c853', label: 'Smooth', range: '80–100' },
            { color: '#ffb300', label: 'Moderate', range: '50–79' },
            { color: '#d50000', label: 'Rough', range: '0–49' },
            { color: '#9ca3af', label: 'No data', range: '' },
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

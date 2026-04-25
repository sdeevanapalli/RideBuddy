import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../context/AuthContext'

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

// forwardRef so Dashboard can call findRoutes / toggleCoverage / etc. via a ref.
const MapView = forwardRef(function MapView({ onStateUpdate }, ref) {
  const { isAuthenticated } = useAuth()
  const mapRef = useRef(null)
  const mapElRef = useRef(null)
  const segmentsLayerRef = useRef(null)
  const coverageLayerRef = useRef(null)
  const qualityLayerRef = useRef(null)
  const highlightLayerRef = useRef(null)

  const [segments, setSegments] = useState([])
  const [showCoverage, setShowCoverage] = useState(false)
  const [coverageLoaded, setCoverageLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [showQuality, setShowQuality] = useState(false)
  const [qualityLoaded, setQualityLoaded] = useState(false)
  const [scoringRoads, setScoringRoads] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  // Stable ref avoids the onStateUpdate callback being a useEffect dependency
  const onStateUpdateRef = useRef(onStateUpdate)
  useEffect(() => { onStateUpdateRef.current = onStateUpdate }, [onStateUpdate])

  // Push state to Dashboard whenever relevant values change
  useEffect(() => {
    onStateUpdateRef.current?.({
      showCoverage, showQuality, syncing, syncStatus, syncResult, scoringRoads,
    })
  }, [showCoverage, showQuality, syncing, syncStatus, syncResult, scoringRoads])

  // Map initialisation
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(mapElRef.current).setView([37.7749, -122.4194], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    segmentsLayerRef.current = L.layerGroup().addTo(map)
    coverageLayerRef.current = L.layerGroup()
    qualityLayerRef.current = L.layerGroup()
    highlightLayerRef.current = L.layerGroup()
    mapRef.current = map
    setMapReady(true)
  }, [])

  useEffect(() => {
    if (isAuthenticated) fetchSyncStatus()
  }, [isAuthenticated])

  // Consume any highlight queued via sessionStorage (standalone /map route)
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

  // Expose imperative API — no dep array so the handle always uses the latest closures
  useImperativeHandle(ref, () => ({
    findRoutes,
    toggleCoverage,
    toggleQuality,
    syncActivities,
    highlight,
  }))

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function authHeaders() {
    const jwt = localStorage.getItem('jwt')
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  function getBoundsString() {
    const map = mapRef.current
    if (!map) return null
    const b = map.getBounds()
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
    const segs = data.segments || []
    setSegments(segs)
    drawSegments(segs)
    setQualityLoaded(false)
  }

  function drawSegments(segs) {
    if (!segmentsLayerRef.current) return
    segmentsLayerRef.current.clearLayers()
    segs.forEach((s) => {
      const start = s.start_latlng
      const end = s.end_latlng
      if (!start || !end) return
      const marker = L.marker([start[0], start[1]])
      const poly = L.polyline([[start[0], start[1]], [end[0], end[1]]], { color: '#2563eb' })
      marker.bindPopup(segmentPopupContent(s))
      poly.on('click', () => marker.openPopup())
      segmentsLayerRef.current.addLayer(marker)
      segmentsLayerRef.current.addLayer(poly)
    })
  }

  function segmentPopupContent(s) {
    const distKm = (s.distance / 1000).toFixed(2)
    return `<div style="min-width:200px"><strong>${s.name}</strong><br/>Distance: ${distKm} km<br/>Avg grade: ${s.avg_grade}%<br/>Efforts: ${s.effort_count || s.efforts || 'N/A'}<br/><button id="save-${s.id}">Save route</button></div>`
  }

  useEffect(() => {
    function attachSaveHandlers() {
      document.querySelectorAll('[id^="save-"]').forEach((btn) => {
        if (btn.dataset.bound) return
        btn.dataset.bound = '1'
        btn.addEventListener('click', () => {
          const id = btn.id.replace('save-', '')
          const seg = segments.find((x) => String(x.id) === String(id))
          if (!seg) return
          const saved = JSON.parse(localStorage.getItem(savedKey) || '[]')
          if (!saved.find((r) => String(r.id) === String(seg.id))) {
            saved.push({ id: seg.id, name: seg.name, distance: seg.distance, start: seg.start_latlng })
            localStorage.setItem(savedKey, JSON.stringify(saved))
            alert('Saved: ' + seg.name)
          } else {
            alert('Already saved')
          }
        })
      })
    }
    const iv = setInterval(attachSaveHandlers, 500)
    return () => clearInterval(iv)
  }, [segments])

  // ── Coverage ─────────────────────────────────────────────────────────────────

  async function fetchSyncStatus() {
    try {
      const resp = await fetch('/api/activities/status', { headers: authHeaders() })
      if (resp.ok) setSyncStatus(await resp.json())
    } catch (_) {}
  }

  async function loadCoverage() {
    if (!coverageLayerRef.current) return
    try {
      const resp = await fetch('/api/activities/coverage', { headers: authHeaders() })
      if (!resp.ok) return
      const geojson = await resp.json()
      coverageLayerRef.current.clearLayers()
      geojson.features.forEach((f) => {
        if (f.geometry.type !== 'LineString') return
        const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        L.polyline(latlngs, { color: '#3b82f6', opacity: 0.5, weight: 2 }).addTo(coverageLayerRef.current)
      })
      setCoverageLoaded(true)
    } catch (_) {}
  }

  async function toggleCoverage() {
    const map = mapRef.current
    if (!map || !coverageLayerRef.current) return
    if (!showCoverage) {
      if (!coverageLoaded) await loadCoverage()
      coverageLayerRef.current.addTo(map)
      setShowCoverage(true)
    } else {
      map.removeLayer(coverageLayerRef.current)
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
        coverageLayerRef.current?.clearLayers()
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
    if (!qualityLayerRef.current) return
    const endpoint = useCache ? '/api/segments/quality/cached' : '/api/segments/quality'
    try {
      const geojson = await fetch(endpoint, { headers: authHeaders() }).then((r) => r.json())
      qualityLayerRef.current.clearLayers()
      ;(geojson.features || []).forEach((f) => {
        if (f.geometry.type !== 'LineString') return
        const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        const { name, quality_score, avg_speed, effort_count, avg_grade, distance } = f.properties
        const color = qualityColor(quality_score)
        const poly = L.polyline(latlngs, { color, weight: 4, opacity: 0.8 })
        const distKm = distance ? (distance / 1000).toFixed(2) : '?'
        const speedKmh = avg_speed ? (avg_speed * 3.6).toFixed(1) : 'N/A'
        const scoreStr = quality_score != null
          ? `${quality_score.toFixed(0)}/100 (${qualityLabel(quality_score)})`
          : 'N/A'
        poly.bindPopup(
          `<div style="min-width:190px">
            <strong>${name || 'Segment'}</strong><br/>
            Quality: ${scoreStr}<br/>
            Median speed: ${speedKmh} km/h<br/>
            Efforts: ${effort_count ?? 'N/A'}<br/>
            Avg grade: ${avg_grade != null ? avg_grade + '%' : 'N/A'}<br/>
            Distance: ${distKm} km
          </div>`
        )
        qualityLayerRef.current.addLayer(poly)
      })
      setQualityLoaded(true)
    } catch (_) {}
  }

  async function toggleQuality() {
    const map = mapRef.current
    if (!map || !qualityLayerRef.current) return
    if (!showQuality) {
      if (!qualityLoaded) {
        setScoringRoads(true)
        await loadQuality(!isAuthenticated)
        setScoringRoads(false)
      }
      qualityLayerRef.current.addTo(map)
      setShowQuality(true)
    } else {
      map.removeLayer(qualityLayerRef.current)
      setShowQuality(false)
    }
  }

  // ── Highlight ─────────────────────────────────────────────────────────────────

  function highlight(encoded, color) {
    try {
      const latlngs = decodePolyline(encoded)
      if (!latlngs.length || !mapRef.current || !highlightLayerRef.current) return
      const colorHex = color === 'purple' ? '#9333ea' : '#f97316'
      highlightLayerRef.current.clearLayers()
      L.polyline(latlngs, { color: colorHex, weight: 5, opacity: 0.9 })
        .addTo(highlightLayerRef.current)
      highlightLayerRef.current.addTo(mapRef.current)
      mapRef.current.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] })
    } catch (_) {}
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      <div ref={mapElRef} className="w-full h-full" />

      {showQuality && (
        <div className="absolute bottom-3 right-3 bg-white p-3 rounded shadow text-xs z-[1000]">
          <div className="font-semibold mb-1.5">Road Quality</div>
          {[
            { color: '#00c853', label: 'Smooth', range: '80–100' },
            { color: '#ffb300', label: 'Moderate', range: '50–79' },
            { color: '#d50000', label: 'Rough', range: '0–49' },
            { color: '#9ca3af', label: 'No data', range: '' },
          ].map(({ color, label, range }) => (
            <div key={label} className="flex items-center gap-1.5 mb-1">
              <span className="inline-block rounded" style={{ width: 16, height: 4, background: color }} />
              <span>
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

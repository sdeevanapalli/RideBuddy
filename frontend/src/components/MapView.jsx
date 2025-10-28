import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const savedKey = 'ridebuddy_saved_routes'

export default function MapView() {
  const mapRef = useRef(null)
  const mapElRef = useRef(null)
  const [segments, setSegments] = useState([])

  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(mapElRef.current).setView([37.7749, -122.4194], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)
    mapRef.current = map
  }, [])

  function getBoundsString() {
    const map = mapRef.current
    if (!map) return null
    const b = map.getBounds()
    // Strava expects bounds as sw_lat,sw_lng,ne_lat,ne_lng
    return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`
  }

  async function findRoutes() {
    const bounds = getBoundsString()
    if (!bounds) return
    const resp = await fetch(`/api/segments?bounds=${encodeURIComponent(bounds)}`)
    if (!resp.ok) {
      const text = await resp.text()
      alert('Error fetching segments: ' + text)
      return
    }
    const data = await resp.json()
    // Strava returns { segments: [...] }
    const segs = data.segments || []
    setSegments(segs)
    drawSegments(segs)
  }

  function drawSegments(segs) {
    const map = mapRef.current
    if (!map) return
    // clear existing overlays in a simple way
    map.eachLayer((layer) => {
      if (layer.options && layer.options.pane === 'overlayPane') {
        map.removeLayer(layer)
      }
    })

    segs.forEach((s) => {
      const start = s.start_latlng
      const end = s.end_latlng
      if (start && end) {
        const marker = L.marker([start[0], start[1]]).addTo(map)
        const poly = L.polyline([[start[0], start[1]], [end[0], end[1]]], { color: 'blue' }).addTo(map)
        marker.bindPopup(popupContent(s))
        poly.on('click', () => {
          marker.openPopup()
        })
      }
    })
  }

  function popupContent(s) {
    const distKm = (s.distance / 1000).toFixed(2)
    return `<div style="min-width:200px"><strong>${s.name}</strong><br/>Distance: ${distKm} km<br/>Avg grade: ${s.avg_grade}%<br/>Efforts: ${s.effort_count || s.efforts || 'N/A'}<br/><button id=\"save-${s.id}\">Save route</button></div>`
  }

  // attach click handler for save buttons inside popups
  useEffect(() => {
    function onMapClick() {
      // delegate clicks for popup save buttons
      document.querySelectorAll('[id^="save-"]').forEach((btn) => {
        if (btn.dataset.bound) return
        btn.dataset.bound = '1'
        btn.addEventListener('click', (e) => {
          const id = btn.id.replace('save-', '')
          const seg = segments.find((x) => String(x.id) === String(id))
          if (!seg) return
          const saved = JSON.parse(localStorage.getItem(savedKey) || '[]')
          if (!saved.find((r) => String(r.id) === String(seg.id))) {
            saved.push({ id: seg.id, name: seg.name, distance: seg.distance, start: seg.start_latlng })
            localStorage.setItem(savedKey, JSON.stringify(saved))
            alert('Saved route: ' + seg.name)
          } else {
            alert('Already saved')
          }
        })
      })
    }

    // run periodically to attach to new popup content
    const iv = setInterval(onMapClick, 500)
    return () => clearInterval(iv)
  }, [segments])

  return (
    <div className="relative h-[calc(100vh-64px)]">
      <div ref={mapElRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 bg-white p-2 rounded shadow">
        <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={findRoutes}>Find Routes</button>
      </div>
    </div>
  )
}

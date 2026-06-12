// Mapa placówek (Leaflet + OpenStreetMap): pinezki klikalne = filtr lokalizacji.
// Wybór miasta/placówki z wyszukiwarki dolatuje mapą do celu.
import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface GeoArea { lat: number; lng: number; km: number }

// odległość po kuli ziemskiej [km]
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

export interface MapClinic {
  clinic_id: number
  clinic_name: string
  address: string
  city: string | null
  lat: number | null
  lng: number | null
}

// oba stany w primary teal — aktywny ciemniejszy i większy
const pinIcon = (active: boolean) => L.divIcon({
  className: '',
  html: `<div style="width:${active ? 30 : 24}px;height:${active ? 30 : 24}px;
    border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);
    background:${active ? '#0F766E' : '#0D9488'};border:3px solid #fff;
    box-shadow:0 2px 6px rgba(13,148,136,.45)"></div>`,
  iconSize: [active ? 30 : 24, active ? 30 : 24],
  iconAnchor: [active ? 15 : 12, active ? 30 : 24],
  popupAnchor: [0, -24],
})

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.flyTo(points[0], 14, { duration: 0.8 })
    else if (points.length > 1) map.flyToBounds(L.latLngBounds(points).pad(0.35), { duration: 0.8 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)])
  return null
}

function ClickArea({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

export function ClinicMap({ clinics, selected, onSelect, geo, onGeoPick }: {
  clinics: MapClinic[]
  selected: string | null
  onSelect: (filter: string) => void
  /** zaznaczony obszar (punkt + promień) — klik w mapę poza pinem */
  geo?: GeoArea | null
  onGeoPick?: (lat: number, lng: number) => void
}) {
  const pts = clinics.filter(c => c.lat != null && c.lng != null)
  if (pts.length === 0) return null

  const focus = selected?.startsWith('cli:')
    ? pts.filter(c => c.clinic_name === selected.slice(4))
    : selected?.startsWith('city:')
      ? pts.filter(c => c.city === selected.slice(5))
      : geo
        ? pts.filter(c => distanceKm(geo.lat, geo.lng, c.lat!, c.lng!) <= geo.km)
        : pts

  return (
    <div className="overflow-hidden rounded-2xl">
      <MapContainer
        center={[pts[0].lat!, pts[0].lng!]}
        zoom={11}
        scrollWheelZoom={false}
        className="z-0 h-72 w-full"
      >
        {/* monochromatyczna baza CARTO Positron — spójna z resztą UI */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />
        <FitTo points={(focus.length ? focus : pts).map(c => [c.lat!, c.lng!])} />
        {onGeoPick && <ClickArea onPick={onGeoPick} />}
        {geo && (
          <Circle
            center={[geo.lat, geo.lng]}
            radius={geo.km * 1000}
            pathOptions={{ color: '#0D9488', fillColor: '#0D9488', fillOpacity: 0.12, weight: 2 }}
          />
        )}
        {pts.map(c => (
          <Marker
            key={c.clinic_id}
            position={[c.lat!, c.lng!]}
            icon={pinIcon(selected === `cli:${c.clinic_name}`)}
            eventHandlers={{ click: () => onSelect(`cli:${c.clinic_name}`) }}
          >
            <Popup>
              <span style={{ fontWeight: 700 }}>{c.clinic_name}</span><br />
              {c.address}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

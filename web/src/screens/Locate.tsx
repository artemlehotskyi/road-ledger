import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { reverseStreet, searchPlaces, type Place } from '../api'
import { CHERNIVTSI_BOUNDS, OSM_ATTRIBUTION, OSM_TILES } from '../config'
import type { Coords, GeocodeInfo } from '../types'
import { PinIcon } from '../icons'
import Header from './Header'

// wait until the map or the query stops changing; the API keeps Nominatim at 1 request/s on top of this
const DEBOUNCE_MS = 600
const MIN_QUERY = 3
const ZOOM = 17

type Nearest =
  | { state: 'loading' }
  | { state: 'ok'; street: string | null }
  | { state: 'outside' }
  | { state: 'error' }

type Search = { state: 'idle' } | { state: 'loading' } | { state: 'done'; results: Place[] } | { state: 'error' }

interface Props {
  start: Coords
  geoDenied: boolean
  noPhotoGps: boolean // gallery photo without EXIF GPS
  onBack: () => void
  onConfirm: (coords: Coords) => void
  onGeocode?: (g: GeocodeInfo) => void // debug panel
}

export default function Locate({ start, geoDenied, noPhotoGps, onBack, onConfirm, onGeocode }: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [center, setCenter] = useState(start)
  const [moving, setMoving] = useState(false)
  const [nearest, setNearest] = useState<Nearest>({ state: 'loading' })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search>({ state: 'idle' })
  const picked = useRef<string | null>(null)

  useEffect(() => {
    const m = L.map(mapEl.current!, {
      center: [start.lat, start.lon],
      zoom: ZOOM,
      minZoom: 12,
      maxBounds: L.latLngBounds(CHERNIVTSI_BOUNDS).pad(0.1),
      maxBoundsViscosity: 1,
      // zoom around the fixed pin, not around the finger or cursor
      touchZoom: 'center',
      doubleClickZoom: 'center',
      scrollWheelZoom: 'center',
    })
    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m)
    // the wheel scrolls the page until the map is clicked
    m.scrollWheelZoom.disable()
    m.on('click focus', () => m.scrollWheelZoom.enable())
    m.on('mouseout blur', () => m.scrollWheelZoom.disable())
    m.on('movestart', () => setMoving(true))
    m.on('moveend', () => {
      const c = m.getCenter()
      setMoving(false)
      setCenter({ lat: c.lat, lon: c.lng })
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    setNearest({ state: 'loading' })
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const r = await reverseStreet(center, ctrl.signal)
        onGeocode?.(r.geocode)
        setNearest(r.in_city ? { state: 'ok', street: r.street } : { state: 'outside' })
      } catch {
        if (!ctrl.signal.aborted) setNearest({ state: 'error' })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [center])

  useEffect(() => {
    const q = query.trim()
    // a picked result fills the field; don't search for it again
    if (q.length < MIN_QUERY || q === picked.current) {
      setSearch({ state: 'idle' })
      return
    }
    setSearch({ state: 'loading' })
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        setSearch({ state: 'done', results: await searchPlaces(q, ctrl.signal) })
      } catch {
        if (!ctrl.signal.aborted) setSearch({ state: 'error' })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  function pick(p: Place) {
    picked.current = p.name
    setQuery(p.name)
    ;(document.activeElement as HTMLElement | null)?.blur()
    map.current?.setView([p.lat, p.lon], ZOOM)
  }

  function confirm() {
    const c = map.current!.getCenter()
    onConfirm({ lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) })
  }

  const outside = nearest.state === 'outside'

  return (
    <main className="page page-locate">
      <Header title="Місце дефекту" onBack={onBack} />
      <h2 className="title-l">Де зроблено фото?</h2>
      {noPhotoGps && <p className="lead lead-strong">У фото немає геолокації. Вкажіть, де його зроблено</p>}
      <p className="lead">Посуньте карту так, щоб точка стала на місце дефекту, або знайдіть вулицю</p>
      {geoDenied && (
        <p className="caption">
          Геолокацію вимкнено для цього сайту. Можна вказати місце на карті або увімкнути: Налаштування →
          Конфіденційність і безпека → Служби геолокації → Сайти Safari.
        </p>
      )}

      <div className="field">
        <label className="label" htmlFor="street-search">Пошук вулиці</label>
        <input
          id="street-search"
          className="input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Наприклад, Головна"
          value={query}
          onChange={(e) => {
            picked.current = null
            setQuery(e.target.value)
          }}
        />
      </div>
      <div aria-live="polite">
        {search.state === 'loading' && <p className="caption">Шукаємо…</p>}
        {search.state === 'error' && <p className="caption">Пошук не відповідає. Спробуйте посунути карту вручну</p>}
        {search.state === 'done' && search.results.length === 0 && (
          <p className="caption">У Чернівцях нічого не знайдено</p>
        )}
        {search.state === 'done' && search.results.length > 0 && (
          <ul className="results">
            {search.results.map((p) => (
              <li key={`${p.name}|${p.place}|${p.lat}`}>
                <button className="result-item" onClick={() => pick(p)}>
                  <span>{p.name}</span>
                  {p.place && <span className="link-sub">{p.place}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="map-wrap">
        <div ref={mapEl} className="map" aria-label="Карта. Місце дефекту — точка в центрі" />
        <div className={`map-pin${moving ? ' map-pin-moving' : ''}`} aria-hidden>
          <svg width="32" height="44" viewBox="0 0 32 44">
            <path d="M16 43C16 43 2 25 2 16a14 14 0 0 1 28 0c0 9-14 27-14 27z" fill="var(--text)" stroke="#fff" strokeWidth="2" />
            <rect x="12" y="12" width="8" height="8" fill="#fff" />
          </svg>
        </div>
        <span className="map-dot" aria-hidden />
      </div>

      <div className="locate-bar">
        <p className="nearest" aria-live="polite">
          <PinIcon size={20} />
          <span>
          {outside ? (
            'Точка поза межами Чернівців'
          ) : (
            <>
              Найближча вулиця:{' '}
              <strong>
                {moving || nearest.state === 'loading'
                  ? '…'
                  : nearest.state === 'error'
                    ? 'не вдалося визначити'
                    : (nearest.street ?? 'не визначено')}
              </strong>
            </>
          )}
          </span>
        </p>
        <button className="btn btn-primary" onClick={confirm} disabled={moving || outside}>
          Підтвердити місце
        </button>
      </div>
    </main>
  )
}

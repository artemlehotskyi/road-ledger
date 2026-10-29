/**
 * Phone position for the photo. iOS Safari shows the permission prompt only inside a user gesture,
 * so the request starts on the tap that opens the camera / gallery, and the result waits while the
 * person takes the photo.
 */
import type { Coords } from './types'

export type GeoStatus =
  | { state: 'idle' }
  | { state: 'requested' }
  | { state: 'ok'; coords: Coords; accuracy: number }
  | { state: 'denied' }
  | { state: 'timeout' }
  | { state: 'unavailable' } // no API, insecure context or position unknown

// long enough to cover the time spent in the camera
const POSITION_TIMEOUT_MS = 30_000
// after the photo is picked, wait at most this long for a pending position
export const PICK_WAIT_MS = 5_000

export function locate(onStatus: (s: GeoStatus) => void): Promise<GeoStatus> {
  return new Promise((resolve) => {
    const done = (s: GeoStatus) => {
      onStatus(s)
      resolve(s)
    }
    if (!navigator.geolocation) return done({ state: 'unavailable' })
    onStatus({ state: 'requested' })
    navigator.geolocation.getCurrentPosition(
      (p) => done({ state: 'ok', coords: { lat: p.coords.latitude, lon: p.coords.longitude }, accuracy: p.coords.accuracy }),
      (e) =>
        done({ state: e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS, maximumAge: 60_000 },
    )
  })
}

/** Coordinates if the position arrives within `ms`, else null. */
export function coordsWithin(p: Promise<GeoStatus>, ms: number): Promise<Coords | null> {
  return Promise.race([
    p.then((s) => (s.state === 'ok' ? s.coords : null)),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ])
}

export function geoLabel(s: GeoStatus) {
  switch (s.state) {
    case 'idle': return 'не запитано'
    case 'requested': return 'запитано'
    case 'ok': return `отримано ±${Math.round(s.accuracy)} м`
    case 'denied': return 'відмовлено'
    case 'timeout': return 'таймаут'
    case 'unavailable': return 'недоступно'
  }
}

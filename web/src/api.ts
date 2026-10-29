import type { AnalyzeResponse, Coords, ErrorKind, LedgerContract } from './types'

const ANALYZE_TIMEOUT_MS = 60_000

export class ApiError extends Error {
  constructor(public kind: ErrorKind) {
    super(kind)
  }
}

export async function fetchContracts(): Promise<LedgerContract[]> {
  const r = await fetch('/api/contracts')
  if (!r.ok) throw new ApiError('server')
  return r.json()
}

export async function analyze(file: File, coords: Coords | null): Promise<AnalyzeResponse> {
  const form = new FormData()
  form.append('image', file)
  if (coords) {
    form.append('lat', String(coords.lat))
    form.append('lon', String(coords.lon))
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ANALYZE_TIMEOUT_MS)
  let r: Response
  try {
    r = await fetch('/api/analyze', { method: 'POST', body: form, signal: ctrl.signal })
  } catch (e) {
    // fetch rejects on no network; abort means the server took too long
    throw new ApiError((e as Error).name === 'AbortError' || navigator.onLine ? 'server' : 'network')
  } finally {
    clearTimeout(timer)
  }
  if (r.status === 400) throw new ApiError('photo')
  if (!r.ok) throw new ApiError('server')
  return r.json()
}

export interface Place {
  name: string
  place: string | null
  lat: number
  lon: number
}

/** Nearest street via the API (Nominatim behind it, 1 request/s). Throws ApiError on failure. */
export async function reverseStreet(c: Coords, signal?: AbortSignal): Promise<{ street: string | null; in_city: boolean }> {
  const r = await fetch(`/api/geocode/reverse?lat=${c.lat}&lon=${c.lon}`, { signal })
  if (!r.ok) throw new ApiError('server')
  return r.json()
}

/** Streets and addresses inside Chernivtsi matching the query. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const r = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`, { signal })
  if (!r.ok) throw new ApiError('server')
  return (await r.json()).results
}

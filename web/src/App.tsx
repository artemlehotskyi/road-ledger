import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { analyze, ApiError } from './api'
import { coordsWithin, geocodeLabel, geoLabel, locate, PICK_WAIT_MS, type GeoStatus } from './geo'
import { mockAnalyze, mockKind } from './mock'
import { CHERNIVTSI_CENTER } from './config'
import type { AppealInput } from './appeal'
import { nextScreen, sendsPhonePosition, type PhotoSource } from './flow'
import type { AnalyzeResponse, Coords, ErrorKind, GeocodeInfo, LocSource } from './types'
import Home from './screens/Home'
import Analysis, { phaseHoldMs, type AnalysisPhase } from './screens/Analysis'
import Result from './screens/Result'
import ErrorScreen from './screens/ErrorScreen'
import HowItWorks from './screens/HowItWorks'
import Locate from './screens/Locate'
import Appeal from './screens/Appeal'

type Screen =
  | { name: 'home' }
  | { name: 'analysis'; photoUrl: string; phase: AnalysisPhase }
  | { name: 'result'; photoUrl: string; data: AnalyzeResponse; locSource: LocSource }
  | { name: 'error'; kind: ErrorKind }
  | { name: 'locate'; start: Coords; noPhotoGps: boolean }
  | { name: 'appeal'; appeal: Omit<AppealInput, 'name' | 'contact'> }
  | { name: 'how' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MOCK = mockKind()
const DEBUG = new URLSearchParams(location.search).get('debug') === '1'

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const run = useRef(0)
  const [geo, setGeo] = useState<GeoStatus>({ state: 'idle' })
  // ?debug=1 only: what went into /analyze and how the street was looked up (no coordinates)
  const [sent, setSent] = useState('—')
  const [geocode, setGeocode] = useState<GeocodeInfo | null>(null)
  const geoRef = useRef<{ status: GeoStatus; pending: Promise<GeoStatus> | null }>({ status: { state: 'idle' }, pending: null })
  const last = useRef<{ file: File; photoUrl: string; source: PhotoSource; coords: Promise<Coords | null> } | null>(null)

  // Browser history mirrors the screens, so iOS swipe-back and Android «Back» stay inside the app.
  // Screens hold blobs and files, so they live here; history.state keeps only the index.
  const entries = useRef<{ screen: Screen; y: number }[]>([{ screen: { name: 'home' }, y: 0 }])
  const at = useRef(0)

  useEffect(() => {
    history.scrollRestoration = 'manual'
    history.replaceState({ i: 0 }, '')
    const onPop = (e: PopStateEvent) => {
      run.current++ // leaving the analysis screen cancels it
      const i = Math.min(typeof e.state?.i === 'number' ? e.state.i : 0, entries.current.length - 1)
      at.current = i
      const { screen, y } = entries.current[i]
      setScreen(screen)
      requestAnimationFrame(() => window.scrollTo(0, y))
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  /** A new step forward: «Back» returns to the current screen. */
  const push = (s: Screen) => {
    entries.current[at.current].y = window.scrollY
    entries.current = [...entries.current.slice(0, at.current + 1), { screen: s, y: 0 }]
    at.current++
    history.pushState({ i: at.current }, '')
    setScreen(s)
    window.scrollTo(0, 0)
  }

  /** Same step, new state (analysis → result): «Back» skips the replaced screen. */
  const replace = (s: Screen) => {
    entries.current[at.current] = { screen: s, y: 0 }
    setScreen(s)
    window.scrollTo(0, 0)
  }

  /** The analysis screen plays its done / failed sequence, then the next screen replaces it. */
  async function finish(id: number, photoUrl: string, phase: 'done' | 'failed') {
    replace({ name: 'analysis', photoUrl, phase })
    await sleep(phaseHoldMs(phase))
    return id === run.current
  }

  /**
   * Analysis → result: the photo moves from one frame to the other (View Transitions, Safari 18+).
   * Without the API, or with reduced motion, the result replaces the screen with the usual fade.
   */
  async function morphTo(s: Screen, photoUrl: string) {
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition
    if (!vt || matchMedia('(prefers-reduced-motion: reduce)').matches) return replace(s)
    // decoded first, so the new snapshot has the photo and not its skeleton
    const img = new Image()
    img.src = photoUrl
    await img.decode().catch(() => {})
    vt.call(document, () => flushSync(() => replace(s)))
  }

  /** The on-screen back arrow does what the browser's «Back» does. */
  const back = () => (at.current > 0 ? history.back() : home())

  async function start(file: File, photoUrl: string, source: PhotoSource, coordsP: Promise<Coords | null>, how: 'push' | 'replace') {
    const id = ++run.current
    last.current = { file, photoUrl, source, coords: coordsP }
    ;(how === 'push' ? push : replace)({ name: 'analysis', photoUrl, phase: 'waiting' })
    try {
      // a point picked on the map always goes to the real API, also in mock mode
      let data: AnalyzeResponse
      if (MOCK && source !== 'map') {
        data = await mockAnalyze(MOCK, photoUrl)
      } else {
        const coords = await coordsP
        setSent(
          source === 'map' ? 'точка з карти'
          : coords ? 'з координатами телефона'
          : source === 'gallery' ? 'без координат (галерея: лише EXIF)'
          : `без координат (не прийшли за ${PICK_WAIT_MS / 1000} с)`,
        )
        data = await analyze(file, coords)
      }
      setGeocode(data.geocode ?? null)
      // the server has done all three steps: they finish together (~0.8 s), then the result
      if (id !== run.current || !(await finish(id, photoUrl, 'done'))) return
      const next = nextScreen(source, data)
      if (next.screen === 'locate') {
        // a gallery photo wasn't sent with the phone position, but it is still the best place to start the map
        const phone = next.noPhotoGps ? await photoCoords() : await coordsP
        if (id !== run.current) return
        replace({ name: 'locate', start: phone ?? CHERNIVTSI_CENTER, noPhotoGps: next.noPhotoGps })
      } else {
        await morphTo({ name: 'result', photoUrl, data, locSource: next.locSource }, photoUrl)
      }
    } catch (e) {
      if (id !== run.current || !(await finish(id, photoUrl, 'failed'))) return
      replace({ name: 'error', kind: e instanceof ApiError ? e.kind : 'server' })
    }
  }

  function requestGeo() {
    const g = geoRef.current
    const onStatus = (s: GeoStatus) => {
      g.status = s
      setGeo(s)
    }
    g.pending = locate(onStatus)
    return g.pending
  }

  // called in the tap that opens the picker: the only moment iOS Safari shows the permission prompt
  function onStart() {
    if (geoRef.current.status.state !== 'requested') requestGeo()
  }

  /** Position for a photo: the request started on the tap, or a new one if that one failed; at most PICK_WAIT_MS. */
  function photoCoords() {
    const g = geoRef.current
    const failed = g.status.state === 'timeout' || g.status.state === 'unavailable' || g.status.state === 'idle'
    const pending = !g.pending || failed ? requestGeo() : g.pending
    return coordsWithin(pending, PICK_WAIT_MS)
  }

  function onPick(file: File, source: 'camera' | 'gallery') {
    if (last.current) URL.revokeObjectURL(last.current.photoUrl)
    start(file, URL.createObjectURL(file), source, sendsPhonePosition(source) ? photoCoords() : Promise.resolve(null), 'push')
  }

  function home() {
    run.current++
    // back to the first history entry; popstate shows the home screen
    if (at.current > 0) history.go(-at.current)
    else replace({ name: 'home' })
  }

  function retry(kind: ErrorKind) {
    const l = last.current
    // the same unreadable file would fail again: pick another one
    if (kind === 'photo' || !l) return home()
    const coords = l.source === 'camera' ? l.coords.then((c) => c ?? photoCoords()) : l.coords
    start(l.file, l.photoUrl, l.source, coords, 'replace')
  }

  function confirmPlace(coords: Coords) {
    const l = last.current
    if (!l) return home()
    // the same File object: the user doesn't pick the photo again
    start(l.file, l.photoUrl, 'map', Promise.resolve(coords), 'replace')
  }

  function changePlace(location: Coords | null) {
    const g = geoRef.current.status
    const phone = g.state === 'ok' ? g.coords : null
    push({ name: 'locate', start: location ?? phone ?? CHERNIVTSI_CENTER, noPhotoGps: false })
  }

  return (
    <>
      {MOCK && <div className="dev-badge">dev: mock={MOCK}</div>}
      {DEBUG && (
        <div className="dev-badge dev-badge-geo">
          геолокація: {geoLabel(geo)}
          {'\n'}в аналіз: {sent}
          {'\n'}вулиця: {geocodeLabel(geocode)}
        </div>
      )}
      {screen.name === 'home' && <Home onStart={onStart} onPick={onPick} onHow={() => push({ name: 'how' })} />}
      {screen.name === 'how' && <HowItWorks onBack={back} />}
      {screen.name === 'analysis' && <Analysis photoUrl={screen.photoUrl} phase={screen.phase} />}
      {screen.name === 'result' && (
        <Result
          photoUrl={screen.photoUrl}
          data={screen.data}
          locSource={screen.locSource}
          accuracy={screen.locSource === 'device' && geo.state === 'ok' ? geo.accuracy : null}
          onRetake={(file) => onPick(file, 'camera')}
          onRetakeStart={onStart}
          onBack={home}
          onChangeStreet={() => changePlace(screen.data.location)}
          onAppeal={(contract, defect) =>
            push({
              name: 'appeal',
              appeal: {
                contract,
                defect,
                street: screen.data.street?.name ?? contract.street,
                coords: screen.data.location,
              },
            })
          }
        />
      )}
      {screen.name === 'error' && <ErrorScreen kind={screen.kind} onRetry={() => retry(screen.kind)} onHome={home} />}
      {screen.name === 'locate' && (
        <Locate
          key={`${screen.start.lat},${screen.start.lon}`}
          start={screen.start}
          geoDenied={geo.state === 'denied'}
          noPhotoGps={screen.noPhotoGps}
          onBack={back}
          onConfirm={confirmPlace}
          onGeocode={setGeocode}
        />
      )}
      {screen.name === 'appeal' && (
        <Appeal appeal={screen.appeal} photo={last.current?.file ?? null} onBack={back} />
      )}
    </>
  )
}

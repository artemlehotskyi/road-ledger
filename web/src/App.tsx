import { useRef, useState } from 'react'
import { analyze, ApiError } from './api'
import { coordsWithin, geoLabel, locate, PICK_WAIT_MS, type GeoStatus } from './geo'
import { mockAnalyze, mockKind } from './mock'
import { CHERNIVTSI_CENTER } from './config'
import type { AppealInput } from './appeal'
import type { AnalyzeResponse, Coords, ErrorKind, LocSource } from './types'
import Home from './screens/Home'
import Analysis from './screens/Analysis'
import Result from './screens/Result'
import ErrorScreen from './screens/ErrorScreen'
import HowItWorks from './screens/HowItWorks'
import Locate from './screens/Locate'
import Appeal from './screens/Appeal'

type Screen =
  | { name: 'home' }
  | { name: 'analysis'; photoUrl: string; step: number }
  | { name: 'result'; photoUrl: string; data: AnalyzeResponse; locSource: LocSource }
  | { name: 'error'; kind: ErrorKind }
  | { name: 'locate'; start: Coords; back: Screen }
  | { name: 'appeal'; appeal: Omit<AppealInput, 'name' | 'contact'>; back: Screen }
  | { name: 'how' }

const STEP_DELAY_MS = 300
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MOCK = mockKind()
const DEBUG = new URLSearchParams(location.search).get('debug') === '1'

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const run = useRef(0)
  const [geo, setGeo] = useState<GeoStatus>({ state: 'idle' })
  const geoRef = useRef<{ status: GeoStatus; pending: Promise<GeoStatus> | null }>({ status: { state: 'idle' }, pending: null })
  const last = useRef<{ file: File; photoUrl: string; coords: Promise<Coords | null>; fromMap: boolean } | null>(null)

  const show = (s: Screen) => {
    setScreen(s)
    window.scrollTo(0, 0)
  }

  async function start(file: File, photoUrl: string, coordsP: Promise<Coords | null>, fromMap = false) {
    const id = ++run.current
    last.current = { file, photoUrl, coords: coordsP, fromMap }
    show({ name: 'analysis', photoUrl, step: 0 })
    try {
      let data: AnalyzeResponse
      let locSource: LocSource
      // a point picked on the map always goes to the real API, also in mock mode
      if (MOCK && !fromMap) {
        data = await mockAnalyze(MOCK, photoUrl)
        locSource = 'device'
      } else {
        const coords = await coordsP
        data = await analyze(file, coords)
        locSource = fromMap ? 'map' : data.location?.source === 'exif' ? 'photo' : 'device'
      }
      for (const step of [1, 2, 3]) {
        if (id !== run.current) return
        setScreen({ name: 'analysis', photoUrl, step })
        await sleep(STEP_DELAY_MS)
      }
      if (id !== run.current) return
      if (data.summary.verdict === 'no_location') {
        show({ name: 'locate', start: (await coordsP) ?? CHERNIVTSI_CENTER, back: { name: 'home' } })
      } else {
        show({ name: 'result', photoUrl, data, locSource })
      }
    } catch (e) {
      if (id !== run.current) return
      show({ name: 'error', kind: e instanceof ApiError ? e.kind : 'server' })
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

  function onPick(file: File) {
    const coords = photoCoords()
    if (last.current) URL.revokeObjectURL(last.current.photoUrl)
    start(file, URL.createObjectURL(file), coords)
  }

  function home() {
    run.current++
    show({ name: 'home' })
  }

  function retry(kind: ErrorKind) {
    const l = last.current
    // the same unreadable file would fail again: pick another one
    if (kind === 'photo' || !l) return home()
    start(l.file, l.photoUrl, l.fromMap ? l.coords : l.coords.then((c) => c ?? photoCoords()), l.fromMap)
  }

  function confirmPlace(coords: Coords) {
    const l = last.current
    if (!l) return home()
    // the same File object: the user doesn't pick the photo again
    start(l.file, l.photoUrl, Promise.resolve(coords), true)
  }

  async function changePlace(back: Screen, location: Coords | null) {
    const phone = last.current && !last.current.fromMap ? await last.current.coords : null
    show({ name: 'locate', start: location ?? phone ?? CHERNIVTSI_CENTER, back })
  }

  return (
    <>
      {MOCK && <div className="dev-badge">dev: mock={MOCK}</div>}
      {DEBUG && <div className="dev-badge dev-badge-geo">геолокація: {geoLabel(geo)}</div>}
      {screen.name === 'home' && <Home onStart={onStart} onPick={onPick} onHow={() => show({ name: 'how' })} />}
      {screen.name === 'how' && <HowItWorks onBack={home} />}
      {screen.name === 'analysis' && <Analysis photoUrl={screen.photoUrl} step={screen.step} />}
      {screen.name === 'result' && (
        <Result
          photoUrl={screen.photoUrl}
          data={screen.data}
          locSource={screen.locSource}
          onBack={home}
          onChangeStreet={() => changePlace(screen, screen.data.location)}
          onAppeal={(contract, defect) =>
            show({
              name: 'appeal',
              appeal: {
                contract,
                defect,
                street: screen.data.street?.name ?? contract.street,
                coords: screen.data.location,
              },
              back: screen,
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
          onBack={() => show(screen.back)}
          onConfirm={confirmPlace}
        />
      )}
      {screen.name === 'appeal' && (
        <Appeal appeal={screen.appeal} photo={last.current?.file ?? null} onBack={() => show(screen.back)} />
      )}
    </>
  )
}

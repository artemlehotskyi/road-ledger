import { useState } from 'react'
import Brand from './Brand'

const STEPS = ['Шукаю дефекти на фото', 'Визначаю вулицю', 'Перевіряю договори Prozorro']

export type AnalysisPhase = 'waiting' | 'done' | 'failed'

// keep in sync with the .step-* rules in styles.css
const STAGGER_MS = 80 // between steps when the answer arrives
const STEP_DONE_MS = 450 // arc 250, then the check 200
const PAUSE_MS = 150 // after the last check, before the result
const FAILED_MS = 400 // cross 200 + pause 200, before the error screen

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** How long the screen stays after the answer, so the sequence finishes before the result replaces it. */
export function phaseHoldMs(phase: Exclude<AnalysisPhase, 'waiting'>) {
  if (phase === 'failed') return reduced() ? PAUSE_MS : FAILED_MS
  return reduced() ? PAUSE_MS : (STEPS.length - 1) * STAGGER_MS + STEP_DONE_MS + PAUSE_MS
}

// The server does all three steps in one request: while it runs only the first is active,
// and when the answer arrives all three are done, because they really are.
export default function Analysis({ photoUrl, phase }: { photoUrl: string; phase: AnalysisPhase }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <main className="page">
      <Brand />
      <div className="photo-frame">
        {!loaded && <div className="skeleton skeleton-photo" />}
        {!failed && (
          <img
            className="photo photo-shared"
            src={photoUrl}
            alt="Вибране фото"
            hidden={!loaded}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <ol className="steps" aria-live="polite">
        {STEPS.map((label, i) => {
          const state =
            phase === 'done' ? 'done'
            : phase === 'failed' ? (i === 0 ? 'failed' : 'pending')
            : i === 0 ? 'active' : 'pending'
          return (
            <li
              key={label}
              className={`step step-${state}${i === 0 ? ' step-first' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <StepIcon />
              {label}
              {state === 'done' && <span className="visually-hidden"> — виконано</span>}
              {state === 'failed' && <span className="visually-hidden"> — помилка</span>}
            </li>
          )
        })}
      </ol>
    </main>
  )
}

/** One icon for every state; the step's class decides what is drawn (styles.css, «analysis steps»). */
function StepIcon() {
  return (
    <span className="step-icon" aria-hidden>
      <svg className="step-ring" width="20" height="20" viewBox="0 0 20 20">
        <circle className="step-track" cx="10" cy="10" r="9" />
        <circle className="step-arc" cx="10" cy="10" r="9" pathLength="100" />
      </svg>
      <svg className="step-badge" width="20" height="20" viewBox="0 0 20 20">
        <circle className="step-disc" cx="10" cy="10" r="10" />
        <path className="step-check" d="M5.5 10.5l3 3 6-7" pathLength="1" />
        <path className="step-cross" d="M6.5 6.5l7 7M13.5 6.5l-7 7" pathLength="1" />
      </svg>
    </span>
  )
}

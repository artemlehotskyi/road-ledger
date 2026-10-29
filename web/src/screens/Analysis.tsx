import { useState } from 'react'
import { Check } from '../icons'
import Brand from './Brand'

const STEPS = ['Шукаю дефекти на фото', 'Визначаю вулицю', 'Перевіряю договори Prozorro']

export default function Analysis({ photoUrl, step }: { photoUrl: string; step: number }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <main className="page">
      <Brand />
      <div className="photo-frame">
        {!loaded && <div className="skeleton skeleton-photo" />}
        {!failed && (
          <img
            className="photo"
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
          const state = i < step ? 'done' : i === step ? 'active' : 'pending'
          return (
            <li key={label} className={`step step-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="step-mark">{state === 'done' && <Check />}</span>
              {label}
              {state === 'done' && <span className="visually-hidden"> — виконано</span>}
            </li>
          )
        })}
      </ol>
    </main>
  )
}

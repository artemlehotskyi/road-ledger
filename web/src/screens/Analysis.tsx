import { useState } from 'react'
import Brand from './Brand'

const STEPS = ['Шукаю дефекти на фото', 'Визначаю вулицю', 'Перевіряю договори Prozorro']

// The server does all three steps in one request: the list says what is happening, without fake progress
export default function Analysis({ photoUrl }: { photoUrl: string }) {
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
        {STEPS.map((label, i) => (
          <li key={label} className={`step step-${i === 0 ? 'active' : 'pending'}`} aria-current={i === 0 ? 'step' : undefined}>
            <span className="step-mark" />
            {label}
          </li>
        ))}
      </ol>
    </main>
  )
}

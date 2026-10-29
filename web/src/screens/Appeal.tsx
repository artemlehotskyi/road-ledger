import { useEffect, useState } from 'react'
import { appealText, type AppealInput } from '../appeal'
import { E_RECEPTION_URL } from '../config'
import { Check, ExternalArrow } from '../icons'
import Header from './Header'

const COPIED_MS = 2000

interface Props {
  appeal: Omit<AppealInput, 'name' | 'contact'>
  photo: File | null
  onBack: () => void
}

export default function Appeal({ appeal, photo, onBack }: Props) {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const text = appealText({ ...appeal, name, contact })
  const canShare = typeof navigator.share === 'function'

  useEffect(() => {
    if (copy !== 'done') return
    const t = setTimeout(() => setCopy('idle'), COPIED_MS)
    return () => clearTimeout(t)
  }, [copy])

  async function share() {
    const files = photo ? [photo] : []
    const data = files.length && navigator.canShare?.({ files }) ? { text, files } : { text }
    try {
      await navigator.share(data)
    } catch {
      // closed by the user or refused by the target app: nothing to report
    }
  }

  return (
    <main className="page">
      <Header title="Звернення" onBack={onBack} />

      <div className="field">
        <label className="label" htmlFor="appeal-name">Прізвище, ім’я</label>
        <input
          id="appeal-name"
          className="input"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="appeal-contact">Телефон або email</label>
        <input
          id="appeal-contact"
          className="input"
          autoComplete="email"
          enterKeyHint="done"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>

      <div className="letter">{text}</div>

      <div className="actions actions-inline">
        <button className="btn btn-primary" onClick={async () => setCopy((await copyText(text)) ? 'done' : 'failed')}>
          {/* the key remounts the label, so the new text fades in */}
          <span key={copy === 'done' ? 'done' : 'idle'} className="btn-label">
            {copy === 'done' ? <><Check /> Скопійовано</> : 'Скопіювати текст'}
          </span>
        </button>
        {canShare && (
          <button className="btn btn-secondary" onClick={share}>Поділитися</button>
        )}
        <a className="btn btn-secondary btn-icon" href={E_RECEPTION_URL} target="_blank" rel="noopener noreferrer">
          Відкрити е-приймальню <ExternalArrow />
        </a>
      </div>
      <p className="caption caption-center">Вхід через ID.gov.ua (Дія або банк)</p>
      <p className="visually-hidden" aria-live="polite">{copy === 'done' ? 'Текст скопійовано' : ''}</p>
      {copy === 'failed' && <p className="caption">Не вдалося скопіювати. Виділіть текст листа вручну</p>}

      <p className="note">
        Звернення надсилаєте ви від свого імені. Road Ledger нічого не надсилає автоматично. Не забудьте додати фото.
      </p>
    </main>
  )
}

/** Clipboard API needs https; on plain http (phone over LAN) fall back to a hidden textarea. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

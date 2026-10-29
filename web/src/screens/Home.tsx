import { useEffect, useState } from 'react'
import { fetchContracts } from '../api'
import { isActive } from '../format'
import Brand from './Brand'

type Stats = { total: number; active: number } | 'loading' | 'error'

interface Props {
  onStart: () => void // tap on «Сфотографувати» / «Обрати з галереї», before the picker opens
  onPick: (file: File) => void
  onHow: () => void
}

export default function Home({ onStart, onPick, onHow }: Props) {
  const [stats, setStats] = useState<Stats>('loading')

  useEffect(() => {
    fetchContracts()
      .then((all) => {
        const list = all.filter((c) => c.scope === 'street')
        setStats({ total: list.length, active: list.filter((c) => isActive(c)).length })
      })
      .catch(() => setStats('error'))
  }, [])

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same photo can be picked again
    if (file) onPick(file)
  }

  const value = (n: 'total' | 'active') =>
    stats === 'loading' ? <span className="skeleton skeleton-num" aria-label="Завантаження" /> :
    stats === 'error' ? <span className="muted">немає даних</span> : stats[n]

  return (
    <main className="page home">
      <Brand />
      <section className="home-hero">
        <h1 className="title-xl">Сфотографуйте дефект дороги</h1>
        <p className="lead">
          Покажемо, хто ремонтував цю ділянку і чи передбачена гарантія підрядника. Якщо гарантія ще діє,
          можна ініціювати перевірку і ремонт за його рахунок.
        </p>
        <dl className="rows rows-stat">
          <div className="row">
            <dt>Договорів на ремонт вулиць</dt>
            <dd className="num">{value('total')}</dd>
          </div>
          <div className="row">
            <dt>Діючих гарантій підрядників</dt>
            <dd className="num">{value('active')}</dd>
          </div>
        </dl>
        <button className="link link-how" onClick={onHow}>Як це працює</button>
      </section>
      <div className="actions">
        <label className="btn btn-primary">
          <input className="visually-hidden" type="file" accept="image/*" capture="environment" onClick={onStart} onChange={onChange} />
          Сфотографувати
        </label>
        <label className="btn btn-secondary">
          <input className="visually-hidden" type="file" accept="image/*" onClick={onStart} onChange={onChange} />
          Обрати з галереї
        </label>
      </div>
      <p className="note">Дані: Prozorro та OpenStreetMap · Чернівці</p>
    </main>
  )
}

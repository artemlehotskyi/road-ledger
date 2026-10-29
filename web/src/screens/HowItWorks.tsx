import { useEffect, useState } from 'react'
import { fetchContracts } from '../api'
import { ExternalArrow } from '../icons'
import { plural } from '../format'
import type { LedgerContract } from '../types'
import Header from './Header'

type Coverage = { total: number; found: number; noDocs: number; signed: number; draft: number; territory: number }

function coverage(all: LedgerContract[]): Coverage {
  const list = all.filter((c) => c.scope === 'street')
  return {
    territory: all.length - list.length,
    total: list.length,
    found: list.filter((c) => c.warranty_months !== null).length,
    noDocs: list.filter((c) => c.status_check === 'no_docs').length,
    signed: list.filter((c) => c.warranty_source === 'signed_contract').length,
    draft: list.filter((c) => c.warranty_source === 'tender_draft' || c.warranty_source === 'contract_attachment').length,
  }
}

const STEPS: [string, string][] = [
  ['Фото', 'Модель комп’ютерного зору шукає на фото ями, тріщини й латки та позначає їх рамками. Тип дефекту можна виправити вручну.'],
  ['Вулиця', 'Координати беремо з телефона або з фото. За ними OpenStreetMap повертає назву вулиці, зокрема з урахуванням перейменувань.'],
  ['Договори Prozorro', 'Шукаємо в базі договори на ремонт цієї вулиці і показуємо підрядника, суму, строк гарантії, цитату з договору та посилання на документи.'],
]

const SOURCES: [string, string, string][] = [
  ['Prozorro', 'договори Департаменту інфраструктури та благоустрою Чернівецької міської ради, 2023–2026', 'https://prozorro.gov.ua'],
  ['OpenStreetMap', 'назви вулиць', 'https://www.openstreetmap.org'],
  ['road-damage-det', 'відкритий датасет фото доріг, Roboflow Universe, CC BY 4.0', 'https://universe.roboflow.com/baka-1ravj/road-damage-det'],
]

const LIMITS = [
  'Договір зіставляється з фото за назвою вулиці, а не за точною ділянкою ремонту. Ділянку з назви договору показуємо окремим рядком.',
  'Модель розпізнавання допоміжна: вона може помилитись, тип дефекту можна виправити вручну.',
  'Дата закінчення гарантії орієнтовна: точний строк рахується від акта приймання робіт, а акти на Prozorro не публікуються.',
  'Сервіс не встановлює юридичну відповідальність підрядника і нічого не надсилає автоматично.',
  'Фото не зберігаються: сервер аналізує його і одразу видаляє з пам’яті.',
  'Щоб визначити вулицю, координати надсилаються в сервіс OpenStreetMap (Nominatim). Самі ми координати в логи й на диск не записуємо.',
]

export default function HowItWorks({ onBack }: { onBack: () => void }) {
  const [cov, setCov] = useState<Coverage | 'loading' | 'error'>('loading')

  useEffect(() => {
    fetchContracts()
      .then((list) => setCov(coverage(list)))
      .catch(() => setCov('error'))
  }, [])

  // same states as the numbers on the home screen
  const count = (k: 'signed' | 'draft') =>
    cov === 'loading' ? <span className="skeleton skeleton-num" aria-label="Завантаження" /> :
    cov === 'error' ? <span className="muted">немає даних</span> : cov[k]

  return (
    <main className="page">
      <Header title="Як це працює" onBack={onBack} />
      <p className="lead lead-top">
        Road Ledger знаходить потенційні гарантійні випадки, показує документи і допомагає ініціювати перевірку.
      </p>

      <section className="block">
        <h2 className="section-title">Що робить сервіс</h2>
        <ol className="prose-list">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <h3>{i + 1}. {title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="block">
        <h2 className="section-title">Джерела</h2>
        <ul className="links">
          {SOURCES.map(([name, what, url]) => (
            <li key={name}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <span>
                  {name}
                  <span className="link-sub">{what}</span>
                </span>
                <ExternalArrow />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2 className="section-title">Охоплення</h2>
        {cov === 'loading' && <span className="skeleton skeleton-text" aria-label="Завантаження" />}
        {cov === 'error' && <p className="muted">Не вдалося завантажити дані бази.</p>}
        {typeof cov === 'object' && (
          <>
            <p className="prose">
              {cov.total} {plural(cov.total, ['договір', 'договори', 'договорів'])} на ремонт вулиць; гарантія знайдена
              в документах у {cov.found}; у {cov.noDocs} {plural(cov.noDocs, ['записі', 'записах', 'записах'])} вибірки
              документів для перевірки гарантії не опубліковано.
            </p>
            <p className="prose prose-muted">
              {cov.territory} {plural(cov.territory, ['договір стосується', 'договори стосуються', 'договорів стосуються'])}{' '}
              територій установ (двори шкіл тощо) і не {cov.territory === 1 ? 'враховується' : 'враховуються'} при
              перевірці вулиць.
            </p>
          </>
        )}
      </section>

      <section className="block">
        <h2 className="section-title">Як рахуємо гарантію</h2>
        <p className="prose">
          Строк гарантії береться з тексту договору або проєкту договору в тендерній документації, з дослівною цитатою.
          Дата «орієнтовно до» рахується від завершення договору, а не від акта приймання робіт.
        </p>
        <dl className="rows rows-stat">
          <div className="row">
            <dt>Підписаний договір</dt>
            <dd className="num">{count('signed')}</dd>
          </div>
          <div className="row">
            <dt>Проєкт договору — потребує перевірки</dt>
            <dd className="num">{count('draft')}</dd>
          </div>
        </dl>
      </section>

      <section className="block">
        <h2 className="section-title">Обмеження</h2>
        <ul className="prose-list">
          {LIMITS.map((t) => (
            <li key={t}>
              <p>{t}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

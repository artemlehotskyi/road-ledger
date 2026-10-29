import { useState } from 'react'
import { ExternalArrow } from '../icons'
import { DEFECT_CHOICES, DEFECT_LABEL, defectsFound, fmtAmount, fmtDate, fmtUntil, fmtWarranty, verdictContract } from '../format'
import type { AnalyzeResponse, Contract, DefectChoice, LocSource } from '../types'
import Header from './Header'

const LOC_TEXT: Record<LocSource, string> = {
  device: 'координати з телефона',
  photo: 'координати з фото',
  map: 'місце вказано на карті',
}

const NO_DEFECTS_PREFIX = 'Дефектів не виявлено. '

const CONFIDENCE_TEXT = {
  high: 'Підтверджено текстом підписаного договору',
  medium: 'Гарантія лише за проєктом договору',
}

const COVERAGE = 'База охоплює договори Департаменту інфраструктури та благоустрою за 2023–2026 роки'
const DATE_NOTE = 'Точний строк рахується від акта приймання робіт.'

interface Props {
  photoUrl: string
  data: AnalyzeResponse
  locSource: LocSource
  onBack: () => void
  onChangeStreet: () => void
  onAppeal: (contract: Contract, defect: DefectChoice | null) => void
}

export default function Result({ photoUrl, data, locSource, onBack, onChangeStreet, onAppeal }: Props) {
  const { verdict, title } = data.summary
  const main = verdictContract(data.contracts)
  const contracts = main ? [main, ...data.contracts.filter((c) => c !== main)] : []
  const headline = data.summary.headline.startsWith(NO_DEFECTS_PREFIX)
    ? data.summary.headline.slice(NO_DEFECTS_PREFIX.length)
    : data.summary.headline
  const hasDefects = data.detections.length > 0
  const renamed = [...data.contracts, ...data.other_works].find((c) => c.matched_alias?.kind === 'renamed')?.matched_alias
  const detected: DefectChoice | null = data.detections[0]?.class ?? null
  const [defect, setDefect] = useState<DefectChoice | null>(detected)
  const [picking, setPicking] = useState(false)
  const manual = defect !== detected

  // colour carries the same meaning as the title next to it
  const tone =
    verdict === 'active' && main?.warranty_confidence === 'high' ? 'ok' : verdict === 'expired' ? 'bad' : 'neutral'
  const text = verdict === 'no_contracts' && data.street ? COVERAGE : headline
  const dated = (verdict === 'active' || verdict === 'expired') && main?.warranty_until

  return (
    <main className="page">
      <Header title="Результат" onBack={onBack} />

      <PhotoWithBoxes photoUrl={photoUrl} data={data} />
      {hasDefects ? (
        <p className="caption">{defectsFound(data.detections)} · {LOC_TEXT[locSource]}</p>
      ) : (
        <>
          <p className="caption caption-strong">Дефектів на фото не знайдено. Спробуйте зняти ближче</p>
          <p className="caption">{LOC_TEXT[locSource][0].toUpperCase() + LOC_TEXT[locSource].slice(1)}</p>
        </>
      )}
      {manual && defect && (
        <p className="caption caption-strong">
          Тип дефекту: {DEFECT_CHOICES.find(([k]) => k === defect)![1].toLowerCase()} · вказано вручну
        </p>
      )}
      <button className="link" onClick={() => setPicking(!picking)} aria-expanded={picking}>
        {hasDefects || defect ? 'Не той дефект? Змінити' : 'Вказати тип дефекту'}
      </button>
      {picking && (
        <fieldset className="choices">
          <legend className="label">Тип дефекту</legend>
          {DEFECT_CHOICES.map(([value, label]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="defect"
                checked={defect === value}
                onChange={() => {
                  setDefect(value)
                  setPicking(false)
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <section className="block">
        <h2 className="label">Вулиця</h2>
        <p className="street">{data.street?.name ?? 'Не вдалося визначити'}</p>
        {renamed && <p className="secondary">раніше — {oldName(renamed.evidence)}</p>}
        <button className="link" onClick={onChangeStreet}>Не та вулиця? Змінити</button>
      </section>

      <section className={`verdict verdict-${tone}`}>
        <h2 className="verdict-title">
          <span className="verdict-square" aria-hidden />
          {title}
        </h2>
        <p className="verdict-text">{text}</p>
        {main && verdict !== 'no_contracts' && (
          <p className="verdict-site">
            {main.site ? <>Ділянка за договором: {main.site}</> : 'Межі ділянки в договорі не вказано'}
          </p>
        )}
        {dated && <p className="verdict-note">{DATE_NOTE}</p>}
        {dated && main?.warranty_confidence && (
          <p className="verdict-confidence">{CONFIDENCE_TEXT[main.warranty_confidence]}</p>
        )}
      </section>

      {verdict === 'active' && main && (
        <div className="actions actions-inline">
          <button className="btn btn-primary" onClick={() => onAppeal(main, defect)}>Підготувати звернення</button>
        </div>
      )}

      {contracts.map((c, i) => (
        <ContractBlock key={c.contract_id} contract={c} index={i} total={contracts.length} />
      ))}

      {data.other_works.length > 0 && (
        <section className="block">
          <h2 className="section-title">Інші роботи за цією адресою</h2>
          <p className="caption caption-top">
            Ці роботи стосуються дворів і територій установ, тому не враховуються у висновку для вулиці.
          </p>
          {data.other_works.map((c) => (
            <OtherWork key={c.contract_id} contract={c} />
          ))}
        </section>
      )}

      {contracts.length + data.other_works.length > 0 && (
        <p className="note">Дата «орієнтовно до» розрахована від завершення договору. {DATE_NOTE}</p>
      )}
    </main>
  )
}

/** «OSM old_name=Білоруська вулиця» → «Білоруська вулиця». */
function oldName(evidence: string) {
  const m = evidence.match(/old_name=(.+)$/)
  return m ? m[1] : evidence
}

function PhotoWithBoxes({ photoUrl, data }: { photoUrl: string; data: AnalyzeResponse }) {
  const [loaded, setLoaded] = useState(false)
  const { width, height } = data.image_size
  return (
    <div className="photo-frame" style={{ aspectRatio: `${width} / ${height}` }}>
      {!loaded && <div className="skeleton skeleton-fill" />}
      <img className="photo" src={photoUrl} alt="Фото дороги" onLoad={() => setLoaded(true)} hidden={!loaded} />
      {loaded &&
        data.detections.map((d, i) => {
          const [x1, y1, x2, y2] = d.box
          // boxes are in image pixels; percentages scale them to the rendered size
          const top = (y1 / height) * 100
          return (
            <div
              key={i}
              className="box"
              style={{
                left: `${(x1 / width) * 100}%`,
                top: `${top}%`,
                width: `${((x2 - x1) / width) * 100}%`,
                height: `${((y2 - y1) / height) * 100}%`,
              }}
            >
              <span className={`box-label${top < 6 ? ' box-label-inside' : ''}`}>
                {DEFECT_LABEL[d.class]} {Math.round(d.confidence * 100)}%
              </span>
            </div>
          )
        })}
    </div>
  )
}

function ContractBlock({ contract: c, index, total }: { contract: Contract; index: number; total: number }) {
  const draft = c.warranty_source === 'tender_draft' || c.warranty_source === 'contract_attachment'
  return (
    <section className="block">
      <h2 className="section-title">
        Договір на ремонт{total > 1 && <span className="muted"> · {index + 1} з {total}</span>}
      </h2>
      <dl className="rows">
        <Row k="Підрядник" v={c.contractor} />
        <Row k="Роботи" v={c.title} />
        <Row k="Сума" v={fmtAmount(c.amount)} />
        <Row k="Договір" v={contractRef(c)} />
        <Row k="Prozorro" v={c.contract_id} />
        <Row k="Гарантія" v={fmtWarranty(c)} />
        <Row k="Діє" v={c.warranty_until ? fmtUntil(c.warranty_until) : 'невідомо'} />
      </dl>

      {c.warranty_quote && (
        <>
          <h3 className="label">{draft ? 'З проєкту договору' : 'З тексту договору'}</h3>
          <blockquote className="quote">«{c.warranty_quote}»</blockquote>
        </>
      )}

      <ul className="links">
        <li>
          <a href={c.tender_url} target="_blank" rel="noopener noreferrer">
            Тендер {c.id} <ExternalArrow />
          </a>
        </li>
        {c.source_url && (
          <li>
            <a href={c.source_url} target="_blank" rel="noopener noreferrer">
              {c.warranty_source === 'tender_draft' ? 'Тендерна документація на Prozorro' : 'Документ договору на Prozorro'}{' '}
              <ExternalArrow />
            </a>
          </li>
        )}
      </ul>
    </section>
  )
}

function OtherWork({ contract: c }: { contract: Contract }) {
  return (
    <div className="other-work">
      <p className="other-work-title">{c.title}</p>
      <dl className="rows">
        <Row k="Підрядник" v={c.contractor} />
        <Row k="Гарантія" v={c.warranty_until ? fmtUntil(c.warranty_until) : fmtWarranty(c)} />
      </dl>
      <ul className="links">
        <li>
          <a href={c.tender_url} target="_blank" rel="noopener noreferrer">
            Тендер {c.id} <ExternalArrow />
          </a>
        </li>
      </ul>
    </div>
  )
}

function contractRef(c: Contract) {
  if (!c.contract_number) return 'номер не вказано'
  return `№ ${c.contract_number}${c.date_signed ? ` від ${fmtDate(c.date_signed)}` : ''}`
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

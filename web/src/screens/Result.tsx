import { useState, type ReactNode } from 'react'
import {
  ContractIcon, DefectIcon, DocEmptyIcon, DocQuestionIcon, ExternalArrow, FileIcon, PinIcon, PinOffIcon,
  PinQuestionIcon, ShieldCheckIcon, ShieldOffIcon, ShieldQuestionIcon,
} from '../icons'
import { DEFECT_CHOICES, DEFECT_LABEL, defectsFound, fmtAmount, fmtDate, fmtUntil, fmtWarranty, verdictContract } from '../format'
import type { AnalyzeResponse, Contract, DefectChoice, LocSource } from '../types'
import Header from './Header'

/** Where the coordinates came from, under the street name. */
function locText(source: LocSource, accuracy: number | null) {
  if (source === 'device') return accuracy ? `За геолокацією телефона · ±${Math.round(accuracy)} м` : 'За геолокацією телефона'
  if (source === 'photo') return 'За геолокацією у фото'
  return 'Вказано на карті'
}

const NO_DEFECTS_PREFIX = 'Дефектів не виявлено. '

/** Under the verdict: how the warranty term is known. */
function confidenceText(c: Contract) {
  if (c.warranty_source === 'signed_contract_scan_manual') return 'Підтверджено підписаним договором (перевірено вручну)'
  if (c.warranty_confidence === 'high') return 'Підтверджено текстом підписаного договору'
  return 'Гарантія лише за проєктом договору'
}

const COVERAGE = 'База охоплює договори Департаменту інфраструктури та благоустрою за 2023–2026 роки'
const DATE_NOTE = 'Точний строк рахується від акта приймання робіт.'

interface Props {
  photoUrl: string
  data: AnalyzeResponse
  locSource: LocSource
  accuracy: number | null // phone GPS accuracy, metres; only for locSource = device
  onBack: () => void
  onChangeStreet: () => void
  onAppeal: (contract: Contract, defect: DefectChoice | null) => void
  onRetake: (file: File) => void
  onRetakeStart: () => void // the tap that opens the camera: geolocation is requested in it
}

export default function Result(p: Props) {
  const { photoUrl, data, locSource, accuracy, onBack, onChangeStreet, onAppeal } = p
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
  const defectLabel = defect && DEFECT_CHOICES.find(([k]) => k === defect)![1].toLowerCase()

  // colour carries the same meaning as the title next to it
  const tone =
    verdict === 'active' && main?.warranty_confidence === 'high' ? 'ok' : verdict === 'expired' ? 'bad' : 'neutral'
  const text = verdict === 'no_contracts' && data.street ? COVERAGE : headline
  const dated = (verdict === 'active' || verdict === 'expired') && main?.warranty_until
  const outside = verdict === 'outside'

  return (
    <main className="page">
      <Header title="Результат" onBack={onBack} />

      <PhotoWithBoxes photoUrl={photoUrl} data={data} />

      <ul className="facts">
        <li className="fact reveal-row">
          <span className="fact-icon"><DefectIcon /></span>
          <div className="fact-body">
            <p className="fact-title">{hasDefects ? defectsFound(data.detections) : 'Дефектів на фото не знайдено'}</p>
            <p className="fact-sub">
              {manual && defectLabel ? `Тип вказано вручну: ${defectLabel}`
                : hasDefects ? 'Розпізнано моделлю на фото' : 'Спробуйте зняти ближче або вкажіть тип'}
            </p>
          </div>
          <button className="fact-action" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            {hasDefects || defect ? 'Змінити' : 'Вказати'}
          </button>
        </li>
        {picking && (
          <li>
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
          </li>
        )}
        <li className="fact reveal-row" style={{ '--r': 1 } as React.CSSProperties}>
          <span className="fact-icon"><PinIcon /></span>
          <div className="fact-body">
            <p className="fact-title">{data.street?.name ?? 'Вулицю не визначено'}</p>
            {renamed && <p className="fact-sub">раніше — {oldName(renamed.evidence)}</p>}
            <p className="fact-sub">{locText(locSource, accuracy)}</p>
          </div>
          <button className="fact-action" onClick={onChangeStreet}>Змінити</button>
        </li>
      </ul>

      <VerdictPanel
        tone={tone}
        icon={verdictIcon(verdict, main)}
        title={title}
        text={text}
        site={main && verdict !== 'no_contracts' && !outside
          ? (main.site ? <>Ділянка за договором: {main.site}</> : 'Межі ділянки в договорі не вказано')
          : null}
        note={dated ? DATE_NOTE : null}
        confirmation={dated && main?.warranty_confidence ? confidenceText(main) : null}
      />

      {verdict === 'active' && main && (
        <div className="actions actions-inline">
          <button className="btn btn-primary" onClick={() => onAppeal(main, defect)}>Підготувати звернення</button>
        </div>
      )}
      {outside && (
        <div className="actions actions-inline">
          <button className="btn btn-primary" onClick={onChangeStreet}>Вказати місце на карті</button>
          <label className="btn btn-secondary">
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onClick={p.onRetakeStart}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // the same photo can be picked again
                if (file) p.onRetake(file)
              }}
            />
            Зробити інше фото
          </label>
        </div>
      )}

      {contracts.map((c, i) => (
        <ContractBlock key={c.contract_id} contract={c} index={i} total={contracts.length} />
      ))}

      {data.other_works.length > 0 && (
        <section className="block">
          <h2 className="section-title section-title-icon"><ContractIcon size={20} />Інші роботи за цією адресою</h2>
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

function verdictIcon(verdict: AnalyzeResponse['summary']['verdict'], main: Contract | null) {
  const size = 32
  switch (verdict) {
    case 'active':
      return main?.warranty_confidence === 'high' ? <ShieldCheckIcon size={size} /> : <ShieldQuestionIcon size={size} />
    case 'expired': return <ShieldOffIcon size={size} />
    case 'unknown': return <DocQuestionIcon size={size} />
    case 'no_contracts': return <DocEmptyIcon size={size} />
    case 'outside': return <PinOffIcon size={size} />
    case 'no_location': return <PinQuestionIcon size={size} />
  }
}

/** Dates in the conclusion are the figure people look for: bold. */
function emphasize(text: string) {
  return text.split(/(\d{2}\.\d{2}\.\d{4})/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

interface PanelProps {
  tone: 'ok' | 'bad' | 'neutral'
  icon: ReactNode
  title: string
  text: string
  site: ReactNode
  note: string | null
  confirmation: string | null
}

/**
 * The conclusion, the most visible thing on the page: tinted panel, icon beside the label and title,
 * the text across the full width, how the term is confirmed under a thin line.
 */
function VerdictPanel({ tone, icon, title, text, site, note, confirmation }: PanelProps) {
  return (
    <section className={`vp verdict-${tone}`}>
      <div className="vp-head">
        <span className="vp-icon">{icon}</span>
        <div>
          <p className="vp-label">Висновок</p>
          <h2 className="vp-title">{title}</h2>
        </div>
      </div>
      <p className="vp-text">{emphasize(text)}</p>
      {site && <p className="vp-site">{site}</p>}
      {note && <p className="vp-note">{note}</p>}
      {confirmation && <p className="vp-confirm"><FileIcon size={16} />{confirmation}</p>}
    </section>
  )
}

/** «OSM old_name=Білоруська вулиця» → «Білоруська вулиця». */
function oldName(evidence: string) {
  const m = evidence.match(/old_name=(.+)$/)
  return m ? m[1] : evidence
}

function PhotoWithBoxes({ photoUrl, data }: { photoUrl: string; data: AnalyzeResponse }) {
  // from the analysis screen the photo is already decoded: no skeleton, no fade, so the shared transition has it
  const [cached] = useState(() => {
    const img = new Image()
    img.src = photoUrl
    return img.complete
  })
  const [loaded, setLoaded] = useState(cached)
  const { width, height } = data.image_size
  return (
    <div className="photo-frame" style={{ aspectRatio: `${width} / ${height}` }}>
      {!loaded && <div className="skeleton skeleton-fill" />}
      <img className={`photo photo-shared${cached ? ' photo-cached' : ''}`} src={photoUrl} alt="Фото дороги" onLoad={() => setLoaded(true)} />
      {loaded &&
        data.detections.map((d, i) => {
          const [x1, y1, x2, y2] = d.box
          // boxes are in image pixels; percentages scale them to the rendered size
          const top = (y1 / height) * 100
          // a label on a box in the right half hangs from the box's right edge, or the frame would clip it
          const right = (x1 + x2) / 2 > width / 2
          return (
            <div
              key={i}
              className="box"
              style={{
                // drawn one by one after the photo settles
                '--i': Math.min(i, 4),
                left: `${(x1 / width) * 100}%`,
                top: `${top}%`,
                width: `${((x2 - x1) / width) * 100}%`,
                height: `${((y2 - y1) / height) * 100}%`,
              } as React.CSSProperties}
            >
              {/* corner brackets instead of a frame: the defect itself stays visible */}
              <span className="corner corner-tl" />
              <span className="corner corner-tr" />
              <span className="corner corner-br" />
              <span className="corner corner-bl" />
              <span className={`box-label${top < 6 ? ' box-label-inside' : ''}${right ? ' box-label-right' : ''}`}>
                {DEFECT_LABEL[d.class]} {Math.round(d.confidence * 100)}%
              </span>
            </div>
          )
        })}
    </div>
  )
}

/** «перевірено вручну за сканом підписаного договору, п. 2.5, с. 1» → «п. 2.5»; null when the source names no clause. */
function clause(note: string | null) {
  return note?.match(/п\.\s?[\d.]*\d/)?.[0] ?? null
}

function ContractBlock({ contract: c, index, total }: { contract: Contract; index: number; total: number }) {
  const draft = c.warranty_source === 'tender_draft' || c.warranty_source === 'contract_attachment'
  const manual = c.warranty_source === 'signed_contract_scan_manual'
  // after a manual check the quote is still the draft text, which the signed scan repeats
  const quoteLabel = manual ? 'З проєкту договору (у підписаному — так само)' : draft ? 'З проєкту договору' : 'З тексту договору'
  const point = clause(c.warranty_quote_note)
  return (
    <section className="block">
      <h2 className="section-title section-title-icon">
        <ContractIcon size={20} />
        <span>Договір на ремонт{total > 1 && <span className="muted"> · {index + 1} з {total}</span>}</span>
      </h2>
      <dl className="rows">
        <Row k="Підрядник" v={c.contractor} />
        <Row k="Роботи" v={c.title} />
        <Row k="Сума" v={fmtAmount(c.amount)} strong />
        <Row k="Договір" v={contractRef(c)} />
        <Row k="Prozorro" v={c.contract_id} />
        <Row k="Гарантія" v={fmtWarranty(c)} />
        <Row k="Діє" v={c.warranty_until ? fmtUntil(c.warranty_until) : 'невідомо'} strong={!!c.warranty_until} />
      </dl>

      {c.warranty_quote ? (
        <figure className="quote">
          <span className="quote-mark" aria-hidden>«</span>
          <blockquote>{c.warranty_quote}</blockquote>
          <figcaption>{quoteLabel}{point && `, ${point}`}</figcaption>
        </figure>
      ) : (
        // no quote (e.g. only a scan): the note still says which clause and page
        c.warranty_quote_note && <p className="caption">{c.warranty_quote_note[0].toUpperCase() + c.warranty_quote_note.slice(1)}</p>
      )}

      <ul className="links">
        <DocLink href={c.tender_url}>Тендер {c.id}</DocLink>
        {c.source_url && (
          <DocLink href={c.source_url}>
            {c.warranty_source === 'tender_draft' ? 'Тендерна документація на Prozorro'
              : manual ? 'Скан підписаного договору на Prozorro' : 'Документ договору на Prozorro'}
          </DocLink>
        )}
      </ul>
    </section>
  )
}

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <FileIcon size={20} />
        <span className="links-text">{children}</span>
        <ExternalArrow />
      </a>
    </li>
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
        <DocLink href={c.tender_url}>Тендер {c.id}</DocLink>
      </ul>
    </div>
  )
}

function contractRef(c: Contract) {
  if (!c.contract_number) return 'номер не вказано'
  return `№ ${c.contract_number}${c.date_signed ? ` від ${fmtDate(c.date_signed)}` : ''}`
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="row">
      <dt>{k}</dt>
      <dd className={strong ? 'dd-strong' : undefined}>{v}</dd>
    </div>
  )
}

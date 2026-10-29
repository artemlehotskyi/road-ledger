/**
 * Temporary dev mode: ?mock=active|review|expired|unknown|no_contracts|territory|no_defects|no_location
 * replaces POST /analyze with a local response. Contracts and aliases are real records
 * from api/data/; detections, coordinates and the street are synthetic.
 */
import type { AnalyzeResponse, Contract, Detection, LedgerContract, MatchedAlias } from './types'
import { fmtDate, todayIso, verdictContract } from './format'

export const MOCK_KINDS = ['active', 'review', 'expired', 'unknown', 'no_contracts', 'territory', 'no_defects', 'no_location'] as const
export type MockKind = (typeof MOCK_KINDS)[number]

export function mockKind(): MockKind | null {
  const v = new URLSearchParams(location.search).get('mock')
  return (MOCK_KINDS as readonly string[]).includes(v ?? '') ? (v as MockKind) : null
}

type Box = [number, number, number, number] // fractions of width/height

interface Scenario {
  street: { name: string; key: string } | null
  ledgerKey?: string // contracts with this street key
  contractIds?: string[] // or exactly these contracts
  alias?: string // ledger_key of the street_aliases.json row to attach
  detections: [Detection['class'], number, Box][]
}

const SCENARIOS: Record<MockKind, Scenario> = {
  // demo street: signed contract (high)
  active: {
    street: { name: 'Зелена вулиця', key: 'зелена' },
    ledgerKey: 'зелена',
    detections: [
      ['pothole', 0.712, [0.18, 0.52, 0.46, 0.74]],
      ['pothole', 0.641, [0.56, 0.62, 0.84, 0.88]],
      ['patching', 0.603, [0.08, 0.2, 0.38, 0.36]],
    ],
  },
  // street scope, warranty from the draft contract in the tender docs (medium); no renamed street-scope case exists
  review: {
    street: { name: 'Горішня вулиця', key: 'горішня' },
    ledgerKey: 'горішня',
    detections: [['pothole', 0.684, [0.3, 0.45, 0.7, 0.75]]],
  },
  // the only expired contract in the base; on the real street it sits next to an active one
  expired: {
    street: { name: 'Миргородська вулиця', key: 'миргородська' },
    contractIds: ['UA-2023-03-22-002239-a-c1'],
    detections: [['crack', 0.552, [0.22, 0.4, 0.78, 0.58]]],
  },
  unknown: {
    street: { name: 'Університетська вулиця', key: 'університетська' },
    ledgerKey: 'університетська',
    detections: [['pothole', 0.684, [0.3, 0.45, 0.7, 0.75]]],
  },
  no_contracts: {
    street: { name: 'Хотинська вулиця', key: 'хотинська' },
    contractIds: [],
    detections: [['pothole', 0.771, [0.25, 0.5, 0.65, 0.8]]],
  },
  // renamed street, only school-yard contracts there: no street verdict, two other works
  territory: {
    street: { name: 'вулиця Українських Добровольців', key: 'українських добровольців' },
    ledgerKey: 'білоруська',
    alias: 'білоруська',
    detections: [['pothole', 0.684, [0.3, 0.45, 0.7, 0.75]]],
  },
  no_defects: {
    street: { name: 'Зелена вулиця', key: 'зелена' },
    ledgerKey: 'зелена',
    detections: [],
  },
  no_location: { street: null, contractIds: [], detections: [] },
}

const DRAFT_TERMS = ' за умовами проєкту договору'
const COVERAGE = 'База охоплює договори Департаменту інфраструктури та благоустрою за 2023–2026 роки.'

// port of summarize() in api/main.py, for the cases the scenarios hit
function summarize(street: Scenario['street'], contracts: Contract[], detections: Detection[]): AnalyzeResponse['summary'] {
  const defects = detections.length ? '' : 'Дефектів не виявлено. '
  if (!street) {
    return { verdict: 'no_location', title: 'Немає координат',
      headline: defects + 'Немає координат: додайте геолокацію, щоб перевірити гарантію.' }
  }
  if (!contracts.length) {
    return { verdict: 'no_contracts', title: 'Ремонтів у базі немає',
      headline: defects + `На вулиці «${street.name}» договорів на ремонт у базі немає. ${COVERAGE}` }
  }
  const c = verdictContract(contracts)!
  const terms = c.warranty_confidence === 'medium' ? DRAFT_TERMS : ''
  if (c.verdict === 'active') {
    return { verdict: 'active',
      title: c.warranty_confidence === 'high' ? 'Можливий гарантійний випадок' : 'Потребує перевірки',
      headline: defects +
        `На цій вулиці є договір на ремонт з гарантією орієнтовно до ${fmtDate(c.warranty_until!)}${terms}. ` +
        `Якщо дефект на ділянці, яку ремонтував ${c.contractor}, його можуть зобов’язати усунути дефект за власний рахунок.` }
  }
  if (c.verdict === 'unknown') {
    const noDocs = contracts.filter((x) => x.verdict === 'unknown').every((x) => x.status_check === 'no_docs')
    return { verdict: 'unknown', title: 'Недостатньо даних', headline: defects + (noDocs
      ? 'Документів для перевірки гарантії на Prozorro не опубліковано.'
      : 'Ремонт тут був, але строку гарантії в документах на Prozorro не знайдено.') }
  }
  return { verdict: 'expired', title: 'Гарантія, ймовірно, закінчилась', headline: defects +
    `Гарантія підрядника ${c.contractor}${terms} закінчилась орієнтовно ${fmtDate(c.warranty_until!)}.` }
}

const CONFIDENCE = { signed_contract: 'high', contract_attachment: 'medium', tender_draft: 'medium' } as const

export async function mockAnalyze(kind: MockKind, photoUrl: string): Promise<AnalyzeResponse> {
  const [{ default: ledger }, { default: aliasFile }, size] = await Promise.all([
    import('../../api/data/contracts.json'),
    import('../../api/data/street_aliases.json'),
    imageSize(photoUrl),
    new Promise((r) => setTimeout(r, 1200)),
  ])
  const s = SCENARIOS[kind]
  const alias = (aliasFile.aliases as (MatchedAlias & { osm_name: string })[]).find((a) => a.ledger_key === s.alias)
  const today = todayIso()
  // as find_contracts() in api/main.py: street scope feeds the verdict, territory is listed as other works
  const onStreet = (ledger as LedgerContract[])
    .filter((c) => (s.contractIds ? s.contractIds.includes(c.contract_id) : c.street_keys.includes(s.ledgerKey!)))
    .map((c): Contract => ({
      ...c,
      verdict: !c.warranty_until ? 'unknown' : c.warranty_until >= today ? 'active' : 'expired',
      warranty_confidence: c.warranty_months === null || c.warranty_source === 'none' ? null : CONFIDENCE[c.warranty_source],
      matched_alias: alias
        ? { ledger_key: alias.ledger_key, kind: alias.kind, source_url: alias.source_url, evidence: alias.evidence }
        : null,
    }))
  const contracts = onStreet.filter((c) => c.scope === 'street')
  const otherWorks = onStreet.filter((c) => c.scope === 'territory')
  const detections: Detection[] = s.detections.map(([cls, confidence, [x1, y1, x2, y2]]) => ({
    class: cls,
    confidence,
    box: [x1 * size.width, y1 * size.height, x2 * size.width, y2 * size.height],
  }))
  return {
    detections,
    image_size: size,
    location: s.street ? { lat: 48.2915, lon: 25.9403, source: 'manual' } : null,
    street: s.street,
    contracts,
    other_works: otherWorks,
    summary: summarize(s.street, contracts, detections),
  }
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 1280, height: 960 })
    img.src = url
  })
}

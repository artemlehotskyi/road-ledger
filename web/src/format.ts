import type { Contract, DefectChoice, DefectClass, Detection, LedgerContract } from './types'

/** Ukrainian plural: forms for 1, 2–4, 5+. */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const DEFECT_LABEL: Record<DefectClass, string> = {
  pothole: 'Яма',
  crack: 'Тріщина',
  patching: 'Латка',
}

export const DEFECT_CHOICES: [DefectChoice, string][] = [
  ['pothole', 'Яма'],
  ['crack', 'Тріщина'],
  ['patching', 'Латка'],
  ['other', 'Інше'],
]

// accusative after «Знайдено»: 1 яму, 2 ями, 5 ям
const DEFECT_FORMS: Record<DefectClass, [string, string, string]> = {
  pothole: ['яму', 'ями', 'ям'],
  crack: ['тріщину', 'тріщини', 'тріщин'],
  patching: ['латку', 'латки', 'латок'],
}

export function defectsFound(detections: Detection[]) {
  const order: DefectClass[] = ['pothole', 'crack', 'patching']
  const parts = order
    .map((cls) => [cls, detections.filter((d) => d.class === cls).length] as const)
    .filter(([, n]) => n > 0)
    .map(([cls, n]) => `${n} ${plural(n, DEFECT_FORMS[cls])}`)
  return `Знайдено ${parts.join(', ')}`
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function todayIso() {
  const t = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

export function isActive(c: LedgerContract, today = todayIso()) {
  return c.warranty_until !== null && c.warranty_until >= today
}

export function fmtAmount(amount: number) {
  const digits = Number.isInteger(amount) ? 0 : 2
  return `${amount.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })} грн`
}

export function fmtUntil(iso: string) {
  return `орієнтовно до ${fmtDate(iso)}`
}

export function fmtWarranty(c: Contract) {
  const m = c.warranty_months
  if (m === null) {
    return c.status_check === 'no_docs'
      ? 'невідомо: документів на Prozorro немає'
      : 'невідомо: у документах на Prozorro строку немає'
  }
  if (m % 12 === 0) return `${m / 12} ${plural(m / 12, ['рік', 'роки', 'років'])}`
  return `${m} ${plural(m, ['місяць', 'місяці', 'місяців'])}`
}

const CONFIDENCE_RANK = { high: 2, medium: 1 } as const

/** Same choice as headline_priority in api/main.py: higher confidence, then later end date. */
function priority(c: Contract): [number, string] {
  return [c.warranty_confidence ? CONFIDENCE_RANK[c.warranty_confidence] : 0, c.warranty_until ?? '']
}

function maxBy(list: Contract[]) {
  return list.reduce((best, c) => {
    const [a, b] = [priority(c), priority(best)]
    return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? c : best
  })
}

/** Contract the summary verdict is based on, mirroring summarize() in api/main.py. */
export function verdictContract(contracts: Contract[]): Contract | null {
  if (!contracts.length) return null
  const active = contracts.filter((c) => c.verdict === 'active')
  if (active.length) return maxBy(active)
  const unknown = contracts.find((c) => c.verdict === 'unknown')
  if (unknown) return unknown
  return maxBy(contracts)
}

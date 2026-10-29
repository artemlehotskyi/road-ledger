/**
 * Text of a resident's appeal to the city council, shown and edited on the appeal screen.
 * It asks to check whether the site belongs to the contract's works, not to make the contractor pay.
 */
import { fmtDate, fmtUntil } from './format'
import type { Contract, Coords, DefectChoice } from './types'

const DEFECT_TEXT: Record<DefectChoice, string> = {
  pothole: 'яма',
  crack: 'тріщина',
  patching: 'пошкоджена латка',
  other: 'пошкодження',
}

export interface AppealInput {
  contract: Contract
  street: string
  coords: Coords | null
  defect: DefectChoice | null
  name?: string // signature lines, left out when empty
  contact?: string
}

function contractRef(c: Contract) {
  const num = c.contract_number ? `№ ${c.contract_number}` : ''
  const date = c.date_signed ? `від ${fmtDate(c.date_signed)}` : ''
  return ['договором', num, date, `(Prozorro ${c.contract_id})`].filter(Boolean).join(' ')
}

export function appealText({ contract: c, street, coords, defect, name, contact }: AppealInput) {
  const what = defect ? `дефект дорожнього покриття (${DEFECT_TEXT[defect]})` : 'дефект дорожнього покриття'
  const where = coords ? `${street}, координати ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` : street
  const lines = [
    `Виявлено ${what}: ${where}. Фото додаю.`,
    '',
    `За даними Prozorro, на цій вулиці виконувались роботи «${c.title}» (підрядник ${c.contractor}).`,
  ]
  if (c.warranty_until && c.warranty_months) {
    lines.push(
      `Гарантійний строк за ${c.warranty_confidence === 'high' ? 'договором' : 'проєктом договору'} — ` +
        `${c.warranty_months} міс., ${fmtUntil(c.warranty_until)} (точний строк рахується від акта приймання робіт).`,
    )
  }
  lines.push(
    '',
    `Прошу перевірити, чи належить ця ділянка до робіт за ${contractRef(c)}, і, якщо так, ініціювати ` +
      `усунення дефекту в межах гарантійних зобов’язань підрядника ${c.contractor}.`,
  )
  const signature = [name, contact].map((v) => v?.trim()).filter(Boolean) as string[]
  if (signature.length) lines.push('', ...signature)
  return lines.join('\n')
}

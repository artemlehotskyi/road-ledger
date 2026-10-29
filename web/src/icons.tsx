const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
  'aria-hidden': true,
}

export function ArrowBack() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...common}>
      <path d="M20 12H5M11 5l-7 7 7 7" />
    </svg>
  )
}

export function ExternalArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" {...common}>
      <path d="M4 2h8v8M12 2L2 12" />
    </svg>
  )
}

export function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...common}>
      <path d="M3 9.5l4 4 8-9" />
    </svg>
  )
}

/*
 * Content icons: 24 grid, square caps and mitre joins like the logo, no rounded corners.
 * The stroke stays ~1.8 px on screen at any size.
 */
function Glyph({ size = 24, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" {...common} strokeWidth={(1.8 * 24) / size}>
      {children}
    </svg>
  )
}
type IconProps = { size?: number }

const PIN = 'M12 21.5S5 13.5 5 9a7 7 0 0 1 14 0c0 4.5-7 12.5-7 12.5z'
const SHIELD = 'M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z'
const DOC = 'M6 2.5h8l4.5 4.5v14.5H6zM14 2.5V7h4.5'
// «?» drawn on a 24 grid around (12, 11)
const QUESTION = 'M10 9.5a2 2 0 1 1 2.8 1.8c-.5.2-.8.6-.8 1.2v.7M12 15.2v.1'

/** Defects on the photo: the same corner brackets as on the photo itself. */
export function DefectIcon({ size }: IconProps) {
  return <Glyph size={size}><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M10 10h4v4h-4z" /></Glyph>
}
/** Street / place: the map pin. */
export function PinIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={PIN} /><path d="M10.5 7.5h3v3h-3z" /></Glyph>
}
export function PinOffIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={PIN} /><path d="M3 3l18 18" /></Glyph>
}
export function PinQuestionIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={PIN} /><path d="M10.4 7.6a1.7 1.7 0 1 1 2.4 1.6c-.5.2-.8.6-.8 1.1v.4M12 12.3v.1" /></Glyph>
}
export function ShieldCheckIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={SHIELD} /><path d="M8 12l3 3 5-6" /></Glyph>
}
export function ShieldQuestionIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={SHIELD} /><path d={QUESTION} /></Glyph>
}
export function ShieldOffIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={SHIELD} /><path d="M3 3l18 18" /></Glyph>
}
export function DocQuestionIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={DOC} /><path d="M10.2 12a1.8 1.8 0 1 1 2.5 1.7c-.4.2-.7.5-.7 1v.5M12 17.6v.1" /></Glyph>
}
export function DocEmptyIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={DOC} /><path d="M9 14h6" /></Glyph>
}
/** A repair contract: a page with text. */
export function ContractIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={DOC} /><path d="M9 11h6M9 14.5h6M9 18h4" /></Glyph>
}
/** A document on Prozorro. */
export function FileIcon({ size }: IconProps) {
  return <Glyph size={size}><path d={DOC} /></Glyph>
}

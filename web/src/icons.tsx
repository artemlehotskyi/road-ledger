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

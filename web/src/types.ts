export type ContractVerdict = 'active' | 'expired' | 'unknown'
// outside: beyond the hromada or no street within 60 m, so nothing can be said about repairs
export type SummaryVerdict = ContractVerdict | 'no_contracts' | 'no_location' | 'outside'
export type DefectClass = 'pothole' | 'crack' | 'patching'

export interface Detection {
  class: DefectClass
  confidence: number
  box: [number, number, number, number]
}

export interface MatchedAlias {
  ledger_key: string
  kind: 'renamed' | 'case_form'
  source_url: string
  evidence: string
}

/** Record from GET /contracts (api/data/contracts.json). */
export interface LedgerContract {
  id: string
  contract_id: string
  street: string
  street_key: string
  street_keys: string[]
  locality: string | null
  contractor: string
  contractor_full: string
  amount: number
  work_type: string
  title: string // tender title on Prozorro
  scope: 'street' | 'territory' // territory: school yards etc., never matched to street defects
  scope_basis: string | null
  site: string | null // part of the street named in the title, null if only the street is named
  contract_number: string | null
  date_signed: string | null
  contract_url: string
  warranty_months: number | null
  warranty_until: string | null
  // signed_contract_scan_manual: the signed contract is a scan; the term was checked by hand (warranty_quote_note)
  warranty_source: 'signed_contract' | 'signed_contract_scan_manual' | 'contract_attachment' | 'tender_draft' | 'none'
  warranty_quote_note: string | null // «перевірено вручну за сканом підписаного договору, п. 2.5, с. 2»
  warranty_start_basis: string | null
  warranty_draft: { warranty_months: number | null; warranty_until: string | null; warranty_source: string } | null // before the manual check
  status_check: string
  warranty_quote: string | null
  source_url: string | null
  tender_url: string
  procurement_method: string
}

/** Contract inside POST /analyze: ledger record plus per-request fields. */
export interface Contract extends LedgerContract {
  verdict: ContractVerdict
  warranty_confidence: 'high' | 'medium' | null
  matched_alias: MatchedAlias | null
}

/** How the street was looked up (debug panel); never contains coordinates. */
export interface GeocodeInfo {
  status: 'found' | 'none' | 'outside' | 'error'
  source: 'local' | 'nominatim'
  distance_m: number | null // to the nearest street line of the local index
  detail: string | null
}

export interface AnalyzeResponse {
  detections: Detection[]
  image_size: { width: number; height: number }
  location: { lat: number; lon: number; source: 'manual' | 'exif' } | null
  street: { name: string; key: string } | null
  geocode: GeocodeInfo | null // null without coordinates
  contracts: Contract[]
  other_works: Contract[] // scope=territory on the same street, not part of the verdict
  summary: { verdict: SummaryVerdict; title: string; headline: string }
}

/** Defect type as confirmed or corrected by the user. */
export type DefectChoice = DefectClass | 'other'

/** Where the coordinates came from, as shown to the user. */
export type LocSource = 'device' | 'photo' | 'map'

export type ErrorKind = 'network' | 'server' | 'photo'

export interface Coords {
  lat: number
  lon: number
}

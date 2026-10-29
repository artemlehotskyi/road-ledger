export type ContractVerdict = 'active' | 'expired' | 'unknown'
export type SummaryVerdict = ContractVerdict | 'no_contracts' | 'no_location'
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
  warranty_source: 'signed_contract' | 'contract_attachment' | 'tender_draft' | 'none'
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

export interface AnalyzeResponse {
  detections: Detection[]
  image_size: { width: number; height: number }
  location: { lat: number; lon: number; source: 'manual' | 'exif' } | null
  street: { name: string; key: string } | null
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

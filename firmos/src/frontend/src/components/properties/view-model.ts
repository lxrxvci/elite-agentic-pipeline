import type {
  DepreciationBreakdown,
  DepreciationFieldKey,
  ProformaCellStatus,
  ProformaFigureKey,
} from '@/server/properties'
import type { WorkStatus } from '@/shared/ui/work'

/**
 * Presentation model for the client Properties tab (HANDOFF §20). Plain
 * serializable shapes only - the server page maps drizzle rows into these
 * and the panel never sees a Date or a numeric-typed driver value.
 */

export interface PropertyItem {
  id: number
  name: string
  propertyType: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  isSold: boolean
  soldDate: string | null
  salePrice: string | null
  purchasePrice: string | null
  purchaseDate: string | null
  annualRevenue: string | null
  annualExpenses: string | null
  mortgageLender: string | null
  mortgageBalance: string | null
  monthlyMortgagePayment: string | null
  depreciation: DepreciationBreakdown
  qboClassName: string | null
  merchantProcessor: string | null
}

export interface ProformaCellItem {
  propertyId: number
  propertyName: string
  isSold: boolean
  status: ProformaCellStatus
  figures: Record<string, number | string | undefined>
  fromPortal: boolean
  lastEditedAt: string | null
  lastEditedByName: string | null
}

export interface ProformaRequestItem {
  id: number
  status: 'pending' | 'completed' | 'cancelled'
  createdAt: string
  completedAt: string | null
  requestedByName: string | null
}

export const DEPRECIATION_FIELD_LABELS: Record<DepreciationFieldKey, string> = {
  land_value: 'Land value',
  building_value: 'Building value',
  improvements: 'Improvements',
  furniture_fixtures: 'Furniture & fixtures',
  other: 'Other depreciable basis',
}

export const PROFORMA_FIELD_LABELS: Record<ProformaFigureKey, string> = {
  rental_income: 'Rental income',
  other_income: 'Other income',
  repairs_maintenance: 'Repairs & maintenance',
  property_taxes: 'Property taxes',
  insurance: 'Insurance',
  utilities: 'Utilities',
  management_fees: 'Management fees',
  other_expenses: 'Other expenses',
}

/** Property lifecycle chip: color carries state, the label rides along. */
export const PROPERTY_STATUS_META: Record<'active' | 'sold', { status: WorkStatus; label: string }> = {
  active: { status: 'on_track', label: 'Active' },
  sold: { status: 'on_hold', label: 'Sold' },
}

/** Pro-forma cell chip per §20: sold properties are out of the requirement. */
export const PROFORMA_CELL_META: Record<ProformaCellStatus, { status: WorkStatus; label: string }> = {
  portal_submitted: { status: 'on_track', label: 'Portal submitted' },
  staff_entered: { status: 'deferred', label: 'Staff entered' },
  missing: { status: 'waiting_client', label: 'Missing' },
  sold_excluded: { status: 'on_hold', label: 'Sold - not required' },
}

export const PROFORMA_REQUEST_META: Record<
  ProformaRequestItem['status'],
  { status: WorkStatus; label: string }
> = {
  pending: { status: 'waiting_client', label: 'Request pending' },
  completed: { status: 'on_track', label: 'Request completed' },
  cancelled: { status: 'on_hold', label: 'Request cancelled' },
}

/** "3 of 5 known" - depreciation known-flag coverage for the table. */
export function depreciationKnownSummary(depreciation: DepreciationBreakdown): {
  known: number
  total: number
} {
  const entries = Object.values(depreciation)
  return { known: entries.filter((e) => e.known).length, total: entries.length }
}

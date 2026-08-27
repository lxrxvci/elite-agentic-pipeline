/**
 * Shared property/pro-forma field definitions (HANDOFF §20). Lives in
 * shared/lib because BOTH the server engine (src/server/properties.ts) and
 * the client panels need the same field lists - importing them from the
 * engine would drag the DB layer into client bundles and jsdom tests.
 */

/** Canonical depreciation breakdown fields (per-field known flags). */
export const DEPRECIATION_FIELDS = [
  'land_value',
  'building_value',
  'improvements',
  'furniture_fixtures',
  'other',
] as const
export type DepreciationFieldKey = (typeof DEPRECIATION_FIELDS)[number]

export interface DepreciationField {
  value: number | null
  known: boolean
}
export type DepreciationBreakdown = Record<string, DepreciationField>

/** Annual pro-forma figure fields; missing keys mean "not entered". */
export const PROFORMA_FIGURE_FIELDS = [
  'rental_income',
  'other_income',
  'repairs_maintenance',
  'property_taxes',
  'insurance',
  'utilities',
  'management_fees',
  'other_expenses',
] as const
export type ProformaFigureKey = (typeof PROFORMA_FIGURE_FIELDS)[number]

export type ProformaFigures = Partial<Record<ProformaFigureKey, number>> & { notes?: string }

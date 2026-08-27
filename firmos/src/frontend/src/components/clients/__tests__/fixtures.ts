import type { ClientBilling, ClientDetail, ClientListRow, ClientWork } from '@/server/clients'
import type { ClientYearGrid, YearGridCell, YearGridCellState, YearGridStream } from '@/server/year-grid'

/**
 * Fixtures mirroring the dev seed (src/server/seed.ts): six clients chosen
 * to exercise every lifecycle state - monthly tier 5, monthly tier 15,
 * quarterly, annual, paused, and a project engagement.
 */

const dana = { id: 3, name: 'Dana Whitfield', initials: 'DW' }
const priya = { id: 4, name: 'Priya Raman', initials: 'PR' }
const jorge = { id: 5, name: 'Jorge Medina', initials: 'JM' }
const sofia = { id: 6, name: 'Sofia Lindqvist', initials: 'SL' }

export const seedListRows: ClientListRow[] = [
  {
    id: 1,
    legalName: 'Harborline Marine Supply',
    dbaName: null,
    state: 'active',
    bookkeepingFrequency: 'monthly',
    monthlyCloseTier: '5',
    isRealEstateClient: false,
    manager: dana,
    bookkeeper: jorge,
    openWorkCount: 14,
    health: { score: 92, status: 'in_progress' },
  },
  {
    id: 2,
    legalName: 'Blue Spruce Landscaping',
    dbaName: null,
    state: 'active',
    bookkeepingFrequency: 'monthly',
    monthlyCloseTier: '15',
    isRealEstateClient: false,
    manager: dana,
    bookkeeper: sofia,
    openWorkCount: 9,
    health: { score: 60, status: 'overdue' },
  },
  {
    id: 3,
    legalName: 'Copperline Coffee Roasters',
    dbaName: null,
    state: 'active',
    bookkeepingFrequency: 'quarterly',
    monthlyCloseTier: null,
    isRealEstateClient: false,
    manager: priya,
    bookkeeper: jorge,
    openWorkCount: 4,
    health: { score: 100, status: 'up_to_date' },
  },
  {
    id: 4,
    legalName: 'Northwind Frame & Door',
    dbaName: 'Northwind',
    state: 'active',
    bookkeepingFrequency: 'annual',
    monthlyCloseTier: null,
    isRealEstateClient: false,
    manager: priya,
    bookkeeper: sofia,
    openWorkCount: 0,
    health: { score: 100, status: 'up_to_date' },
  },
  {
    id: 5,
    legalName: 'Redwood Pediatric Therapy',
    dbaName: null,
    state: 'paused',
    bookkeepingFrequency: 'monthly',
    monthlyCloseTier: '10',
    isRealEstateClient: false,
    manager: dana,
    bookkeeper: jorge,
    openWorkCount: 0,
    health: null,
  },
  {
    id: 6,
    legalName: 'Summit Peak Builders',
    dbaName: null,
    state: 'project_only',
    bookkeepingFrequency: 'monthly',
    monthlyCloseTier: '15',
    isRealEstateClient: false,
    manager: priya,
    bookkeeper: sofia,
    openWorkCount: 2,
    health: { score: 100, status: 'up_to_date' },
  },
]

export function makeDetail(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: 1,
    legalName: 'Harborline Marine Supply',
    dbaName: null,
    state: 'active',
    taxStructure: 'S-corp',
    accountingMethod: 'accrual',
    businessAddress: '12 Dock Street',
    businessCity: 'Portland',
    businessState: 'ME',
    businessZip: '04101',
    bookkeepingFrequency: 'monthly',
    billingFrequency: 'monthly',
    monthlyCloseTier: '5',
    bookkeepingStartDate: '2026-01-01',
    bankFeedCatchupDate: '2026-06-01',
    isRealEstateClient: false,
    isProjectEngagement: false,
    projectCutoffDate: null,
    qboClassNames: ['Retail'],
    qboLocationNames: ['Portland'],
    qboUserCount: 2,
    qboSubscriptionTier: 'plus',
    manager: dana,
    bookkeeper: jorge,
    contacts: [
      {
        linkId: 1,
        contactId: 1,
        name: 'Alison Brewer',
        email: 'alison@harborlinemarine.com',
        phone: null,
        relationshipType: 'owner',
        ownershipPercent: '100.00',
        isPrimary: true,
        isCpa: false,
      },
    ],
    owners: [],
    accounts: [
      { id: 1, name: 'Operating Checking', accountType: 'checking', institution: null, statementDay: 31, isActive: true },
    ],
    onboarding: [
      { id: 10, title: 'Collect prior-year books', status: 'completed', assignee: dana, dueDate: '2026-01-05', completedAt: null },
      { id: 11, title: 'Connect bank feeds', status: 'in_progress', assignee: jorge, dueDate: '2026-08-30', completedAt: null },
      { id: 12, title: 'Review chart of accounts', status: 'new', assignee: null, dueDate: null, completedAt: null },
    ],
    ...overrides,
  }
}

export function makeWork(overrides: Partial<ClientWork> = {}): ClientWork {
  return {
    today: '2026-08-23',
    state: 'active',
    isProjectEngagement: false,
    rows: [],
    ...overrides,
  }
}

/** Monthly-cadence year grid fixture: 12 columns, 4 streams, all not_due by default. */
export function makeYearGrid(overrides: Partial<ClientYearGrid> = {}): ClientYearGrid {
  const columns = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1 }))
  const cell = (
    stream: YearGridStream,
    month: number,
    state: YearGridCellState = 'not_due',
  ): YearGridCell => ({
    stream,
    year: 2026,
    month,
    months: [month],
    state,
    total: 0,
    completed: 0,
    waiting: 0,
    open: 0,
    overdue: 0,
  })
  const streams: YearGridStream[] = ['bank_feeds', 'reconciliations', 'reports', 'tasks']
  return {
    clientId: 1,
    year: 2026,
    today: '2026-08-23',
    state: 'active',
    frequency: 'monthly',
    onHold: false,
    note: null,
    columns,
    rows: streams.map((stream) => ({
      stream,
      cells: columns.map((c) => cell(stream, c.month)),
    })),
    ...overrides,
  }
}

export function makeBilling(overrides: Partial<ClientBilling> = {}): ClientBilling {
  return {
    lines: [
      {
        serviceKey: 'bookkeeping_monthly',
        productName: 'Monthly Bookkeeping',
        unitPrice: 850,
        quantity: 1,
        discount: 0,
        frequency: 'monthly',
        notes: null,
        manualEdit: false,
        monthlyAmount: 850,
      },
      {
        serviceKey: 'custom_item_1',
        productName: 'Quarterly payroll review',
        unitPrice: 300,
        quantity: 1,
        discount: 0,
        frequency: 'quarterly',
        notes: 'Added during onboarding',
        manualEdit: true,
        monthlyAmount: 100,
      },
    ],
    monthlyTotal: 950,
    monthlyRecurringAmount: '950.00',
    baseMonthlyAmount: '850.00',
    perAccountPrice: '25.00',
    billingFrequency: 'monthly',
    isAutoPay: true,
    billingLastSyncedAt: null,
    ...overrides,
  }
}

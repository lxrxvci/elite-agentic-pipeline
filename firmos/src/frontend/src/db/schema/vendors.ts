import { index, integer, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { optionListValues, sopTemplates } from './admin'
import { clients } from './clients'
import { createdAt, updatedAt } from './shared'

export const clientVendorAssignments = pgTable(
  'client_vendor_assignments',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    vendorOptionId: integer('vendor_option_id').notNull().references(() => optionListValues.id, { onDelete: 'cascade' }),
    frequency: text('frequency').notNull().default('monthly'),
    paymentMethod: text('payment_method'),
    portalUrlOverride: text('portal_url_override'),
    sopTemplateId: integer('sop_template_id').references(() => sopTemplates.id, { onDelete: 'set null' }),
    sopStatus: text('sop_status'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('client_vendor_assignments_unique').on(table.clientId, table.vendorOptionId),
    index('client_vendor_assignments_client_idx').on(table.clientId),
  ],
)

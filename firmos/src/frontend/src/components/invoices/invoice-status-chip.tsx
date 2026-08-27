import { WorkStatusBadge } from '@/shared/ui/work'

import { invoiceStatusConfig, type InvoiceStatus } from './format'

/**
 * The invoice status chip - one meaning, one token, identical on every
 * surface (list, grid, detail, client Billing tab). Dot + text, never
 * color alone.
 */
export function InvoiceStatusChip({ status, size = 'sm' }: { status: InvoiceStatus; size?: 'sm' | 'md' }) {
  const c = invoiceStatusConfig(status)
  return <WorkStatusBadge status={c.token} label={c.label} size={size} />
}

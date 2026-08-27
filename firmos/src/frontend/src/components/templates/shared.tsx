'use client'

import { Lock } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WorkStatusBadge } from '@/shared/ui/work'

/**
 * Shared bits for the template admin surfaces (§19).
 */

export interface ClientRef {
  id: number
  name: string
}

/** Banner shown when the caller lacks the relevant edit flag (§11). */
export function ReadOnlyNote({ flag }: { flag: string }) {
  return (
    <p
      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      data-testid="template-readonly-note"
    >
      <Lock aria-hidden className="h-3 w-3" />
      Read-only: editing requires the {flag} permission.
    </p>
  )
}

/** isActive display: inactive is a state (on_hold); active is neutral metadata. */
export function ActiveState({ isActive }: { isActive: boolean }) {
  if (!isActive) return <WorkStatusBadge status="on_hold" label="Inactive" />
  return <span className="text-xs text-muted-foreground">Active</span>
}

/** default_assignee_role picker: unassigned, manager, or bookkeeper. */
export function RoleSelect({
  value,
  onChange,
  ariaLabel = 'Default assignee role',
}: {
  value: string | null
  onChange: (value: string | null) => void
  ariaLabel?: string
}) {
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        <SelectItem value="manager">Manager</SelectItem>
        <SelectItem value="bookkeeper">Bookkeeper</SelectItem>
      </SelectContent>
    </Select>
  )
}

/** Client picker for apply/mint actions. */
export function ClientSelect({
  clients,
  value,
  onChange,
  ariaLabel = 'Client',
}: {
  clients: ClientRef[]
  value: number | null
  onChange: (value: number | null) => void
  ariaLabel?: string
}) {
  return (
    <Select
      value={value != null ? String(value) : ''}
      onValueChange={(v) => onChange(v === '' ? null : Number(v))}
    >
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue placeholder="Choose a client" />
      </SelectTrigger>
      <SelectContent>
        {clients.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function roleLabel(role: string | null): string {
  if (role === 'manager') return 'Manager'
  if (role === 'bookkeeper') return 'Bookkeeper'
  return 'Unassigned'
}

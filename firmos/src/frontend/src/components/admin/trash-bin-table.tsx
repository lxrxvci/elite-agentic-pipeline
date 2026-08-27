'use client'

import * as React from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { relativeTime } from '@/components/notifications/relative-time'
import { purgeTaskAction, restoreTaskAction } from '@/server/actions/trash'
import type { TrashedTaskItem } from '@/server/trash'
import { periodLabel } from '@/shared/lib/date-display'

/**
 * /admin/trash table. Restore is one click; permanent delete arms an inline
 * confirm first (same pattern as the purgatory destructive reviews). Rows
 * leave the local list on success so the table reads as the live bin.
 */

function PurgeButton({
  item,
  busy,
  onPurge,
}: {
  item: TrashedTaskItem
  busy: boolean
  onPurge: (item: TrashedTaskItem) => void
}) {
  const [armed, setArmed] = React.useState(false)

  React.useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <Button
      type="button"
      size="sm"
      variant={armed ? 'destructive' : 'ghost'}
      className="h-7 text-xs"
      disabled={busy}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        onPurge(item)
      }}
    >
      {armed ? 'Confirm - irreversible' : 'Delete forever'}
    </Button>
  )
}

export function TrashBinTable({ items: initialItems }: { items: TrashedTaskItem[] }) {
  const [items, setItems] = React.useState<TrashedTaskItem[]>(initialItems)
  const [busyId, setBusyId] = React.useState<number | null>(null)

  async function restore(item: TrashedTaskItem) {
    setBusyId(item.id)
    try {
      const res = await restoreTaskAction(item.id)
      if (!res.ok) {
        toast.error('Restore failed', { description: res.error })
        return
      }
      setItems((list) => list.filter((i) => i.id !== item.id))
      toast.success(`Restored - ${item.title}`)
    } finally {
      setBusyId(null)
    }
  }

  async function purge(item: TrashedTaskItem) {
    setBusyId(item.id)
    try {
      const res = await purgeTaskAction(item.id)
      if (!res.ok) {
        toast.error('Delete failed', { description: res.error })
        return
      }
      setItems((list) => list.filter((i) => i.id !== item.id))
      toast.success(`Deleted permanently - ${item.title}`)
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
          <Trash2 className="h-5 w-5 text-accent-foreground" aria-hidden />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">The trash is empty</h3>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          Soft-deleted tasks land here for 30 days before the scheduled purge removes them for
          good.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Task</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Deleted</TableHead>
            <TableHead>Purge in</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} data-testid="trash-row">
              <TableCell className="pl-4">
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                <span className="ml-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.status.replace(/_/g, ' ')}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {item.clientName ?? 'No client'}
              </TableCell>
              <TableCell>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {periodLabel(item.attributedYear, item.attributedMonth)}
                </span>
              </TableCell>
              <TableCell
                className="text-xs text-muted-foreground"
                title={item.deletedAt.toLocaleString()}
              >
                {relativeTime(item.deletedAt)}
              </TableCell>
              <TableCell className="tnum text-xs text-muted-foreground">
                {item.purgeInDays} {item.purgeInDays === 1 ? 'day' : 'days'}
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => void restore(item)}
                  >
                    <ArchiveRestore aria-hidden className="h-3.5 w-3.5" />
                    Restore
                  </Button>
                  <PurgeButton item={item} busy={busyId === item.id} onPurge={(i) => void purge(i)} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

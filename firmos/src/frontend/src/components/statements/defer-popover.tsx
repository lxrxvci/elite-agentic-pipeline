'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { deferAccountStatementsAction } from '@/server/actions/statements'
import { dayLabel } from '@/shared/lib/date-display'

/**
 * Deferral control for statement queue rows (HANDOFF §5): park an account's
 * statements out to a date. Deferred rows keep their missing count but the
 * overdue flag is suppressed server-side; the badge shows the until-date.
 */

interface DeferPopoverProps {
  accountId: number
  accountName: string
  deferredUntil: string | null
  /** Firm-local today, ISO-local - floors the date input. */
  today: string
  onChanged?: () => void
}

export function DeferPopover({
  accountId,
  accountName,
  deferredUntil,
  today,
  onChanged,
}: DeferPopoverProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [until, setUntil] = useState(deferredUntil ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(value: string | null) {
    setPending(true)
    setError(null)
    const res = await deferAccountStatementsAction(accountId, value)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.success(
      value ? `${accountName} deferred until ${dayLabel(value)}` : `${accountName} deferral cleared`,
    )
    setOpen(false)
    onChanged?.()
    router.refresh()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setUntil(deferredUntil ?? '')
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label={`Defer statements for ${accountName}`}
          data-testid="defer-trigger"
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {deferredUntil ? dayLabel(deferredUntil) : 'Defer'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64" data-testid="defer-popover">
        <div className="space-y-2">
          <Label htmlFor={`defer-until-${accountId}`} className="text-xs font-semibold">
            Defer statements until
          </Label>
          <Input
            id={`defer-until-${accountId}`}
            type="date"
            min={today}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="h-8 text-sm"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Missing months still count; the overdue flag is paused until this date.
          </p>
          {error && (
            <p role="alert" className="text-xs font-medium text-status-overdue">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {deferredUntil && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={pending}
                onClick={() => void apply(null)}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={pending || until === ''}
              onClick={() => void apply(until)}
              data-testid="defer-submit"
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Defer
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

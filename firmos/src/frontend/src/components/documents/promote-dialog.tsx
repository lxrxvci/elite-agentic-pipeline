'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { promoteToStatementAction } from '@/server/actions/documents'
import { monthLabel } from '@/shared/lib/date-display'

/**
 * Promote-to-statement dialog (HANDOFF §13): converts a general document
 * into a statement for an account. The server resolves the attributed
 * period from the statement date and reports it back; server errors surface
 * verbatim - they are human-readable by contract.
 */

export interface PromoteAccount {
  id: number
  name: string
  institution: string | null
}

interface PromoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: { id: number; fileName: string } | null
  accounts: PromoteAccount[]
}

export function PromoteDialog({ open, onOpenChange, document, accounts }: PromoteDialogProps) {
  const router = useRouter()
  const [accountId, setAccountId] = useState<string>('')
  const [statementDate, setStatementDate] = useState('')
  const [endingBalance, setEndingBalance] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAccountId(accounts.length === 1 ? String(accounts[0].id) : '')
      setStatementDate('')
      setEndingBalance('')
      setError(null)
      setPending(false)
    }
  }, [open, accounts])

  async function submit() {
    if (!document || accountId === '' || statementDate === '') return
    setPending(true)
    setError(null)
    const res = await promoteToStatementAction(
      document.id,
      Number(accountId),
      statementDate,
      undefined,
      endingBalance.trim() === '' ? null : endingBalance.trim(),
    )
    setPending(false)
    if (!res.ok) {
      // Human-readable by contract - shown verbatim.
      setError(res.error)
      return
    }
    const period = monthLabel(res.data.result.period.year, res.data.result.period.month)
    toast.success(`Promoted to statement - attributed to ${period}`)
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="promote-dialog">
        <DialogHeader>
          <DialogTitle>Promote to statement</DialogTitle>
          <DialogDescription>
            {document ? `Move “${document.fileName}” into the statement tree.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="promote-account" className="text-xs">
              Account
            </Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="promote-account" className="h-8 w-full text-sm" aria-label="Account">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.institution ? `${a.name} · ${a.institution}` : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-date" className="text-xs">
              Statement date
            </Label>
            <Input
              id="promote-date"
              type="date"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
              className="h-8 w-44 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              The date printed on the statement; the accounting month is derived from it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-ending-balance" className="text-xs">
              Ending balance <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="relative w-44">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
              >
                $
              </span>
              <Input
                id="promote-ending-balance"
                type="text"
                inputMode="decimal"
                placeholder="12408.22"
                autoComplete="off"
                value={endingBalance}
                onChange={(e) => setEndingBalance(e.target.value)}
                className="tnum h-8 pl-6 text-sm"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md bg-status-overdue-bg px-3 py-2 text-xs font-medium text-status-overdue"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              disabled={pending || accountId === '' || statementDate === ''}
              onClick={() => void submit()}
              data-testid="promote-submit"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Promote
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

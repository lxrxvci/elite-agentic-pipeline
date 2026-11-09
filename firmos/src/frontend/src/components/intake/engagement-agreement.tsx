'use client'

import { useMemo } from 'react'
import { Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { renderEngagementAgreement, type AcceptedEstimateSnapshot, type AgreementTemplate } from '@/shared/lib/engagement'

export function EngagementAgreementDialog({
  open,
  onOpenChange,
  snapshot,
  template,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: AcceptedEstimateSnapshot
  template: AgreementTemplate
}) {
  const body = useMemo(() => renderEngagementAgreement(snapshot, template), [snapshot, template])
  const clientName = snapshot.answers.dbaName ?? snapshot.answers.legalName ?? 'client'

  const download = () => {
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-service-agreement.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="engagement-agreement-dialog">
        <DialogHeader>
          <DialogTitle>Service agreement review</DialogTitle>
          <DialogDescription>
            Generated from the accepted estimate snapshot. Review before downloading or sharing with the client.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 font-sans text-sm leading-6 text-foreground" data-testid="engagement-agreement-body">
          {body}
        </pre>
        <DialogFooter>
          <Button type="button" onClick={download} data-testid="download-agreement">
            <Download className="h-4 w-4" aria-hidden />
            Download for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

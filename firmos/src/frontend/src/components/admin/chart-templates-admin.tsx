'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { approveChartTemplateAction } from '@/server/actions/admin'
import type { ChartAccountTemplate } from '@/shared/lib/chart-templates'

export function ChartTemplatesAdmin({ templates }: { templates: ChartAccountTemplate[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const approve = (id: number) => {
    startTransition(async () => {
      const result = await approveChartTemplateAction(id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Chart template approved')
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="chart-templates-admin">
      <h2 className="text-sm font-semibold text-foreground">Chart-of-accounts templates</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Entity-specific equity terminology. Only approved, active templates affect conversion.
      </p>
      <div className="mt-4 space-y-3">
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-border/70 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium capitalize text-foreground">{template.key.replaceAll('_', ' ')}</p>
                <p className="text-xs text-muted-foreground">Version {template.version} · {template.status}</p>
              </div>
              {template.status !== 'approved' && (
                <Button type="button" size="sm" disabled={pending} onClick={() => approve(template.id)} data-testid={`approve-chart-template-${template.key}`}>
                  Approve
                </Button>
              )}
            </div>
            <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>Contributions: <span className="text-foreground">{template.contributions}</span></div>
              <div>Distributions: <span className="text-foreground">{template.distributions}</span></div>
              <div>Net investment: <span className="text-foreground">{template.netInvestment}</span></div>
              <div>Grouped equity: <span className="text-foreground">{template.grouped}</span></div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}

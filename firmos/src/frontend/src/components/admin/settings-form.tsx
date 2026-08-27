'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { PayoutConfig } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AdminSettings } from '@/server/admin-reads'
import { updateAdminSettingsAction } from '@/server/actions/admin'

/**
 * /admin/settings form (HANDOFF §27): org profile, feature flags, the
 * time-tracking cap, and payroll cadence. One save writes each changed key
 * through updateAdminSettingsAction (admin/owner only, audit-logged); the
 * feature_flags row is merged server-side so unexposed flags survive.
 */

const PAYOUT_OPTIONS: { value: PayoutConfig; label: string }[] = [
  { value: 'next_month_first', label: '1st of next month' },
  { value: 'next_month_second', label: '2nd of next month' },
  { value: 'same_month_second', label: '2nd of the same month' },
]

interface SettingsFormProps {
  settings: AdminSettings
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const [orgName, setOrgName] = React.useState(settings.orgName)
  const [purgeEnabled, setPurgeEnabled] = React.useState(settings.purgeEnabled)
  const [portalEnabled, setPortalEnabled] = React.useState(settings.clientPortalEnabled)
  const [maxHours, setMaxHours] = React.useState(String(settings.maxClockInHours))
  const [payout, setPayout] = React.useState<PayoutConfig>(settings.commissionPayout)
  const [saving, setSaving] = React.useState(false)

  const dirty =
    orgName !== settings.orgName ||
    purgeEnabled !== settings.purgeEnabled ||
    portalEnabled !== settings.clientPortalEnabled ||
    maxHours !== String(settings.maxClockInHours) ||
    payout !== settings.commissionPayout

  async function save() {
    setSaving(true)
    try {
      const res = await updateAdminSettingsAction({
        orgName,
        purgeEnabled,
        clientPortalEnabled: portalEnabled,
        maxClockInHours: Number(maxHours),
        commissionPayout: payout,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Settings saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Section title="Organization" description="The practice name shown across the app.">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Blue Ledger Books"
            className="h-9 max-w-sm text-sm"
          />
        </div>
      </Section>

      <Section
        title="Feature flags"
        description="Kill switches. Purge gates the irreversible client-deletion workflow; the portal flag gates every portal route."
      >
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="flag-purge"
            checked={purgeEnabled}
            onCheckedChange={(v) => setPurgeEnabled(v === true)}
            aria-label="Enable client purge"
          />
          <div>
            <Label htmlFor="flag-purge" className="text-[13px] font-medium">
              Client purge
            </Label>
            <p className="text-xs text-muted-foreground">
              Allows admins to request permanent client deletion. Owner approval still required.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="flag-portal"
            checked={portalEnabled}
            onCheckedChange={(v) => setPortalEnabled(v === true)}
            aria-label="Enable client portal"
          />
          <div>
            <Label htmlFor="flag-portal" className="text-[13px] font-medium">
              Client portal
            </Label>
            <p className="text-xs text-muted-foreground">
              Opens portal routes to client and CPA logins.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Time tracking"
        description="A clock-in session older than this cap is auto-closed by the stale-cleanup job."
      >
        <div className="space-y-1.5">
          <Label htmlFor="max-hours">Max clock-in hours</Label>
          <Input
            id="max-hours"
            value={maxHours}
            onChange={(e) => setMaxHours(e.target.value)}
            inputMode="numeric"
            className="tnum h-9 w-24 text-sm"
          />
        </div>
      </Section>

      <Section
        title="Payroll"
        description="When commission for a month pays out (HANDOFF §6.6)."
      >
        <div className="space-y-1.5">
          <Label htmlFor="payout-cadence">Commission payout cadence</Label>
          <Select value={payout} onValueChange={(v) => setPayout(v as PayoutConfig)}>
            <SelectTrigger id="payout-cadence" className="h-9 w-56 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYOUT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  )
}

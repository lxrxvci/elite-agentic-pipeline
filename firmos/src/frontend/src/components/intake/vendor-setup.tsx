'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { SearchSelect } from '@/components/ui/search-select'
import type { IntakeVendorAssignment } from '@/server/intake'
import type { VendorCatalogRow, VendorDefaultsInput } from '@/server/vendors'
import { normalizePortalUrl } from '@/shared/lib/portal-url'
import { resolvedVendorPortal, VENDOR_FREQUENCIES, VENDOR_PAYMENT_METHODS } from '@/shared/lib/vendor-task-plan'

import { inputCls } from './account-screens'
import { CardNavigation } from './navigation'
import { OptionCards } from './screens'
import { SopChoiceFields } from './sop-choice'
import type { QuestionDef, WizardAnswers } from './registry'

interface VendorSetupProps {
  q: QuestionDef
  answers: WizardAnswers
  mode: 'record' | 'pay'
  intakeId: number
  vendors: VendorCatalogRow[]
  sops: { id: number; title: string }[]
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  onPickOption: (value: string) => void
  onAddVendor: (name: string, input: VendorDefaultsInput) => Promise<VendorCatalogRow | null>
  onRenameVendor: (id: number, name: string) => Promise<VendorCatalogRow | null>
  onVendorDefaults: (id: number, input: VendorDefaultsInput) => Promise<VendorCatalogRow | null>
  showNavigation?: boolean
}

export function VendorSetupScreen(props: VendorSetupProps) {
  const { q, answers, mode, intakeId, vendors, sops, onApply, onAdvance, onPickOption, showNavigation = true } = props
  const [error, setError] = useState<string | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [defaultBusyIds, setDefaultBusyIds] = useState<ReadonlySet<number>>(new Set())
  const setVendorDefaultBusy = useCallback((id: number, busy: boolean) => {
    setDefaultBusyIds((current) => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const current = q.get(answers) as string | undefined
  const assignments: IntakeVendorAssignment[] = answers.vendorAssignments ?? vendors.filter((vendor) =>
    (answers.recordBillVendors ?? []).includes(vendor.name),
  ).map((vendor) => ({
    vendorId: vendor.id,
    vendorName: vendor.name,
    frequency: 'monthly' as const,
    defaultPortalUrl: vendor.defaultPortalUrl,
    sopTemplateId: vendor.sopTemplateId,
  }))

  const commit = (next: IntakeVendorAssignment[]) => {
    onApply({
      vendorAssignments: next,
      recordBillVendors: next.map((assignment) => assignment.vendorName),
      billPayLocations: next.flatMap((assignment) => {
        const portal = resolvedVendorPortal(assignment)
        return portal ? [portal] : []
      }),
    })
  }

  const saving = catalogBusy || defaultBusyIds.size > 0
  const finish = () => {
    if (saving) {
      setError('Wait for the vendor changes to finish saving before continuing.')
      return
    }
    if (current === 'yes' && assignments.length === 0) {
      setError('Select or add a vendor before continuing.')
      return
    }
    if (mode === 'record' && assignments.some((assignment) => (assignment.sopStatus ?? (assignment.sopTemplateId != null ? 'existing' : null)) == null)) {
      setError('Choose an SOP option for every selected vendor.')
      return
    }
    if (mode === 'record' && assignments.some((assignment) => assignment.sopStatus === 'existing' && assignment.sopTemplateId == null)) {
      setError('Choose the existing SOP or select a different SOP option for every vendor.')
      return
    }
    if (mode === 'pay' && current === 'yes' && assignments.some((assignment) => !assignment.paymentMethod)) {
      setError('Choose a payment method for every selected vendor.')
      return
    }
    if (mode === 'pay' && error) return
    setError(null)
    commit(assignments)
    onAdvance()
  }

  const update = (vendorId: number, patch: Partial<IntakeVendorAssignment>) => {
    commit(assignments.map((assignment) => assignment.vendorId === vendorId ? { ...assignment, ...patch } : assignment))
  }
  const selectVendor = (vendor: VendorCatalogRow) => {
    const existing = assignments.find((assignment) => assignment.vendorId === vendor.id)
    if (existing) return
    commit([...assignments, {
      vendorId: vendor.id,
      vendorName: vendor.name,
      frequency: 'monthly',
      defaultPortalUrl: vendor.defaultPortalUrl,
      sopTemplateId: vendor.sopTemplateId,
      sopStatus: vendor.sopTemplateId == null ? null : 'existing',
    }])
  }

  return (
    <div className="space-y-4">
      <OptionCards options={q.options ?? []} current={current} onPick={onPickOption} />
      {current === 'yes' && (
        <>
          {mode === 'record' && (
            <>
              <SearchSelect
                multiple
                ariaLabel="Vendors"
                onBusyChange={setCatalogBusy}
                options={vendors.filter((vendor) => vendor.sopTemplateId != null || assignments.some((assignment) => assignment.vendorId === vendor.id)).map((vendor) => ({
                  id: String(vendor.id),
                  label: vendor.name,
                  description: vendor.sopTemplateId != null ? 'Existing SOP' : 'SOP choice needed',
                  data: vendor,
                }))}
                values={assignments.map((assignment) => String(assignment.vendorId))}
                onChange={(ids) => commit(ids.flatMap((id) => {
                  const existing = assignments.find((assignment) => assignment.vendorId === Number(id))
                  if (existing) return [existing]
                  const vendor = vendors.find((candidate) => candidate.id === Number(id))
                  if (!vendor) return []
                  return [{
                    vendorId: vendor.id,
                    vendorName: vendor.name,
                    frequency: 'monthly' as const,
                    defaultPortalUrl: vendor.defaultPortalUrl,
                    sopTemplateId: vendor.sopTemplateId,
                    sopStatus: vendor.sopTemplateId == null ? null : 'existing' as const,
                  }]
                }))}
                onAdd={async (name) => {
                  const vendor = await props.onAddVendor(name, { intakeId })
                  if (!vendor) throw new Error('Could not add the vendor - try again.')
                  selectVendor(vendor)
                }}
                onRename={async (option, name) => {
                  const vendor = await props.onRenameVendor(option.data.id, name)
                  if (!vendor) throw new Error('Could not rename the vendor - try again.')
                  commit(assignments.map((assignment) => assignment.vendorId === vendor.id
                    ? { ...assignment, vendorName: vendor.name }
                    : assignment))
                }}
                testidPrefix="vendor"
                inputTestid="vendor-input"
                placeholder="Search vendors with existing SOPs…"
                addLabel={(query) => query ? `Add "${query}" as a vendor` : 'Add a vendor…'}
              />
              <SearchSelect
                ariaLabel="All vendors"
                options={vendors.map((vendor) => ({ id: String(vendor.id), label: vendor.name, data: vendor }))}
                value={null}
                onChange={(_id, option) => selectVendor(option.data)}
                placeholder="Search all vendors to add one…"
                testidPrefix="all-vendors"
                inputTestid="all-vendors-input"
              />
            </>
          )}
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendors selected yet.</p>
          ) : (
            <div className="space-y-5" data-testid={`${mode}-vendor-list`}>
              {assignments.map((assignment) => (
                <section key={assignment.vendorId} aria-label={assignment.vendorName} className="pt-3">
                  <h2 className="mb-2 text-sm font-semibold text-foreground">{assignment.vendorName}</h2>
                  <div className={mode === 'record' ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>
                    {mode === 'record' && (
                      <>
                        <NativeSelect
                          aria-label={`Frequency for ${assignment.vendorName}`}
                          value={assignment.frequency}
                          onChange={(event) => update(assignment.vendorId, {
                            frequency: event.target.value as IntakeVendorAssignment['frequency'],
                          })}
                        >
                          {VENDOR_FREQUENCIES.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}
                        </NativeSelect>
                        <SopChoiceFields
                          label={`SOP for ${assignment.vendorName}`}
                          status={assignment.sopStatus ?? (assignment.sopTemplateId != null ? 'existing' : null)}
                          sopTemplateId={assignment.sopTemplateId}
                          sops={sops}
                          onChange={(patch) => update(assignment.vendorId, patch)}
                        />
                      </>
                    )}
                    {mode === 'pay' && (
                      <VendorPaymentFields
                        assignment={assignment}
                        onUpdate={(patch) => update(assignment.vendorId, patch)}
                        onDefaults={props.onVendorDefaults}
                        onError={setError}
                        onBusyChange={setVendorDefaultBusy}
                      />
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="text-sm font-medium text-status-overdue" role="alert">{error}</p>}
      {showNavigation && current != null && <CardNavigation onClick={finish} disabled={saving} data-testid="continue">Continue</CardNavigation>}
    </div>
  )
}

function VendorPaymentFields({
  assignment,
  onUpdate,
  onDefaults,
  onError,
  onBusyChange,
}: {
  assignment: IntakeVendorAssignment
  onUpdate: (patch: Partial<IntakeVendorAssignment>) => void
  onDefaults: VendorSetupProps['onVendorDefaults']
  onError: (message: string | null) => void
  onBusyChange: (vendorId: number, busy: boolean) => void
}) {
  const [portal, setPortal] = useState(resolvedVendorPortal(assignment) ?? '')
  const [saving, setSaving] = useState(false)
  const reportBusy = useCallback((busy: boolean) => onBusyChange(assignment.vendorId, busy), [assignment.vendorId, onBusyChange])
  useEffect(() => {
    reportBusy(saving)
    return () => reportBusy(false)
  }, [reportBusy, saving])
  const saveDefault = async () => {
    setSaving(true)
    try {
      const defaultPortalUrl = normalizePortalUrl(portal)
      if (!defaultPortalUrl) return
      const vendor = await onDefaults(assignment.vendorId, { defaultPortalUrl })
      if (!vendor) throw new Error('Could not save the shared portal URL.')
      onUpdate({ defaultPortalUrl: vendor.defaultPortalUrl, portalUrl: null })
      onError(null)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not save the portal URL.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <NativeSelect
        aria-label={`Payment method for ${assignment.vendorName}`}
        value={assignment.paymentMethod ?? ''}
        onChange={(event) => onUpdate({
          paymentMethod: (event.target.value || null) as IntakeVendorAssignment['paymentMethod'],
        })}
      >
        <option value="">Choose a payment method…</option>
        {VENDOR_PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
      </NativeSelect>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`vendor-portal-${assignment.vendorId}`}>
          Payment portal URL (optional)
        </label>
        <input
          id={`vendor-portal-${assignment.vendorId}`}
          type="url"
          inputMode="url"
          autoComplete="off"
          className={inputCls}
          value={portal}
          placeholder="https://vendor.example.com/pay"
          onChange={(event) => setPortal(event.target.value)}
          onBlur={() => {
            try {
              const portalUrl = normalizePortalUrl(portal)
              onUpdate({ portalUrl })
              onError(null)
            } catch (cause) {
              onError(cause instanceof Error ? cause.message : 'Enter a valid portal URL.')
            }
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">HTTPS only. Keep passwords and tokens in the secure vault, not in this URL.</p>
        <Button type="button" variant="ghost" size="sm" disabled={!portal.trim() || saving} onClick={() => void saveDefault()} data-testid={`save-vendor-default-${assignment.vendorId}`}>
          Save as shared portal default
        </Button>
      </div>
    </>
  )
}

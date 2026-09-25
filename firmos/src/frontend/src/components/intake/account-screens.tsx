'use client'

import { useState } from 'react'
import { ArrowRight, Check, ChevronDown, Minus, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { IntakeAccountInput } from '@/server/intake'
import type { InstitutionRow } from '@/server/institutions'
import { cn } from '@/shared/lib/utils'

import {
  ASSET_TYPE_LABELS,
  PROOF_CATEGORY_LABELS,
  type AccountCountDef,
  type QuestionDef,
} from './registry'

/**
 * I3 (intake restructure, plan §1 screen 7): the per-type account count
 * card. "How many business checking accounts do you have?" generates that
 * many compact mini-forms - name, bank (dropdown + inline add-new) and a
 * login-access checkbox for money accounts; lender/balance and a proof
 * pick for loans; year/value and bill-of-sale proof for vehicles; a typed
 * bucket and proof pick for other assets. Statement day is deliberately
 * absent (a conversion-time concern). Every edit commits straight into the
 * wizard answers, so autosave and resume behave like any other screen.
 */

export const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// ── Institution dropdown + inline add-new ─────────────────────────────────

export function InstitutionSelect({
  institutions,
  selectedId,
  selectedName,
  index,
  onSelect,
  onAdd,
}: {
  institutions: InstitutionRow[]
  selectedId?: number | null
  /** Display fallback for free-text/legacy institutions (no id). */
  selectedName?: string | null
  index: number
  onSelect: (institution: InstitutionRow) => void
  /** Returns the created (or deduped) row; null when the add failed. */
  onAdd: (name: string) => Promise<InstitutionRow | null>
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentName =
    (selectedId != null ? institutions.find((i) => i.id === selectedId)?.name : null) ??
    selectedName ??
    null

  const submitNew = async () => {
    if (newName.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    const row = await onAdd(newName)
    setBusy(false)
    if (!row) {
      setError('Could not add the bank - try again.')
      return
    }
    onSelect(row)
    setNewName('')
    setAdding(false)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`bank-select-${index}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Bank or card issuer"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          inputCls,
          'flex items-center justify-between gap-2 text-left',
          currentName == null && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{currentName ?? 'Select the bank…'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Banks"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-pop"
        >
          {institutions.map((i) => {
            const selected = i.id === selectedId
            return (
              <button
                key={i.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`bank-option-${i.id}`}
                onClick={() => {
                  onSelect(i)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected ? 'font-medium text-accent-foreground' : 'text-foreground',
                )}
              >
                {i.name}
                {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
              </button>
            )
          })}
          {adding ? (
            <form
              className="flex items-center gap-2 border-t border-border p-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submitNew()
              }}
            >
              <input
                aria-label="New bank name"
                data-testid="bank-add-input"
                className={cn(inputCls, 'h-9')}
                placeholder="First Interstate Bank"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- inline reveal: focus follows the user's click
                autoFocus
              />
              <Button type="submit" size="sm" disabled={busy || newName.trim() === ''} data-testid="bank-add-submit">
                {busy ? 'Adding…' : 'Add bank'}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              data-testid={`bank-add-toggle-${index}`}
              onClick={() => setAdding(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2 text-left text-sm font-medium text-firm-brand-strong transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add a new bank…
            </button>
          )}
          {error && (
            <p className="px-3 py-1.5 text-xs font-medium text-status-overdue" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Per-type mini-form fields ─────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-medium text-muted-foreground">{children}</span>
}

function AccountMiniForm({
  def,
  item,
  index,
  institutions,
  onAddInstitution,
  onChange,
  onRemove,
}: {
  def: AccountCountDef
  item: IntakeAccountInput
  index: number
  institutions: InstitutionRow[]
  onAddInstitution: (name: string) => Promise<InstitutionRow | null>
  onChange: (patch: Partial<IntakeAccountInput>) => void
  onRemove: () => void
}) {
  const proof = item.proofCategory ?? def.defaultProof
  return (
    <fieldset
      className="rounded-xl border border-border bg-card p-4"
      data-testid={`account-form-${index}`}
    >
      <legend className="sr-only">Account {index + 1}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden>
          #{index + 1}
        </span>
        <button
          type="button"
          aria-label={`Remove account ${index + 1}`}
          data-testid={`remove-account-${index}`}
          onClick={onRemove}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldLabel>{def.nameLabel}</FieldLabel>
          <input
            aria-label={`${def.nameLabel} ${index + 1}`}
            className={inputCls}
            placeholder={def.namePlaceholder}
            value={item.name ?? ''}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>

        {def.askInstitution && (
          <div>
            <FieldLabel>Bank or card issuer</FieldLabel>
            <InstitutionSelect
              institutions={institutions}
              selectedId={item.institutionId}
              selectedName={item.institution}
              index={index}
              onSelect={(i) => onChange({ institutionId: i.id, institution: i.name })}
              onAdd={onAddInstitution}
            />
          </div>
        )}

        {def.askLender && (
          <div>
            <FieldLabel>Lender</FieldLabel>
            <input
              aria-label={`Lender ${index + 1}`}
              className={inputCls}
              placeholder="Columbia Bank"
              value={item.lender ?? ''}
              onChange={(e) => onChange({ lender: e.target.value || null })}
            />
          </div>
        )}

        {def.askBalance && (
          <div>
            <FieldLabel>Current balance (optional)</FieldLabel>
            <input
              aria-label={`Current balance ${index + 1}`}
              className={cn(inputCls, 'tnum')}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="14,200"
              value={item.balance ?? ''}
              onChange={(e) =>
                onChange({ balance: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </div>
        )}

        {def.askYearValue && (
          <>
            <div>
              <FieldLabel>Year (optional)</FieldLabel>
              <input
                aria-label={`Vehicle year ${index + 1}`}
                className={cn(inputCls, 'tnum')}
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                placeholder="2022"
                value={item.year ?? ''}
                onChange={(e) =>
                  onChange({ year: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </div>
            <div>
              <FieldLabel>Value estimate (optional)</FieldLabel>
              <input
                aria-label={`Vehicle value ${index + 1}`}
                className={cn(inputCls, 'tnum')}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="28,000"
                value={item.value ?? ''}
                onChange={(e) =>
                  onChange({ value: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </div>
          </>
        )}

        {def.askAssetType && (
          <div>
            <FieldLabel>Type</FieldLabel>
            <select
              aria-label={`Asset type ${index + 1}`}
              data-testid={`asset-type-${index}`}
              className={cn(inputCls, 'appearance-none')}
              value={item.assetType ?? ''}
              onChange={(e) => onChange({ assetType: e.target.value || null })}
            >
              <option value="">Select…</option>
              {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        {def.proofOptions ? (
          <div>
            <FieldLabel>Proof</FieldLabel>
            <select
              aria-label={`Proof category ${index + 1}`}
              data-testid={`proof-select-${index}`}
              className={cn(inputCls, 'appearance-none')}
              value={proof}
              onChange={(e) =>
                onChange({ proofCategory: e.target.value as IntakeAccountInput['proofCategory'] })
              }
            >
              {def.proofOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {PROOF_CATEGORY_LABELS[o.value] ?? o.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-end">
            <span
              className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
              data-testid={`proof-locked-${index}`}
            >
              Proof: bank statement
            </span>
          </div>
        )}

        {def.askLoginAccess && (
          <label className="flex h-10 cursor-pointer items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              aria-label={`Grant us login access ${index + 1}`}
              data-testid={`grant-access-${index}`}
              checked={item.grantLoginAccess === true}
              onChange={(e) => onChange({ grantLoginAccess: e.target.checked })}
              className="h-4 w-4 accent-[#007B7F]"
            />
            Grant us login access
            <span className="text-xs text-muted-foreground">(client adds it in the portal)</span>
          </label>
        )}
      </div>
    </fieldset>
  )
}

// ── The count card screen ─────────────────────────────────────────────────

export function AccountCountScreen({
  q,
  items,
  institutions,
  onAddInstitution,
  onCommit,
  onAdvance,
}: {
  q: QuestionDef
  items: IntakeAccountInput[]
  institutions: InstitutionRow[]
  onAddInstitution: (name: string) => Promise<InstitutionRow | null>
  onCommit: (items: IntakeAccountInput[]) => void
  onAdvance: () => void
}) {
  const def = q.accountCount!
  const [error, setError] = useState<string | null>(null)

  const setCount = (raw: number) => {
    const count = Math.max(0, Math.min(20, Math.floor(Number.isFinite(raw) ? raw : 0)))
    if (count === items.length) return
    if (count < items.length) {
      onCommit(items.slice(0, count))
      return
    }
    const blanks: IntakeAccountInput[] = Array.from({ length: count - items.length }, () => ({
      name: '',
      accountType: def.accountType,
      proofCategory: def.defaultProof,
    }))
    onCommit([...items, ...blanks])
  }

  const updateAt = (index: number, patch: Partial<IntakeAccountInput>) =>
    onCommit(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const removeAt = (index: number) => onCommit(items.filter((_, i) => i !== index))

  const finish = () => {
    const unnamed = items.findIndex((item) => (item.name ?? '').trim() === '')
    if (unnamed >= 0) {
      setError(`Name account #${unnamed + 1} or lower the count.`)
      return
    }
    setError(null)
    onAdvance()
  }

  return (
    <div className="space-y-4">
      {/* The count stepper: the number drives how many mini-forms render. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="One fewer"
          data-testid="count-minus"
          disabled={items.length === 0}
          onClick={() => setCount(items.length - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          aria-label={def.countLabel}
          data-testid="count-input"
          className={cn(inputCls, 'tnum h-9 w-16 text-center')}
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          value={items.length}
          onChange={(e) => {
            // An emptied field would otherwise read as 0 and wipe the list.
            if (e.target.value === '') return
            setCount(Number(e.target.value))
          }}
        />
        <button
          type="button"
          aria-label="One more"
          data-testid="count-plus"
          onClick={() => setCount(items.length + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <span className="text-sm text-muted-foreground">
          {items.length === 0 ? 'None - skip ahead if so' : `${items.length} to list`}
        </span>
      </div>

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <AccountMiniForm
              key={i}
              def={def}
              item={item}
              index={i}
              institutions={institutions}
              onAddInstitution={onAddInstitution}
              onChange={(patch) => updateAt(i, patch)}
              onRemove={() => removeAt(i)}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" variant="action" onClick={finish} data-testid="continue">
          {items.length === 0 ? 'Skip for now' : 'Continue'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

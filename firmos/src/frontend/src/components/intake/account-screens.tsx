'use client'

import { useState } from 'react'
import { ArrowRight, Check, ChevronDown, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { IntakeAccountInput } from '@/server/intake'
import type { InstitutionRow } from '@/server/institutions'
import { accountLabel, normalizeLast4 } from '@/shared/lib/account-label'
import { cn } from '@/shared/lib/utils'

import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import {
  accountItemError,
  ASSET_TYPE_LABELS,
  PROOF_CATEGORY_LABELS,
  type AccountCountDef,
  type QuestionDef,
} from './registry'

/**
 * I3 (intake restructure, plan §1 screen 7): the per-type account count
 * card. "How many business checking accounts do you have?" generates that
 * many compact mini-forms. J1 (meeting #3, D1-D6): money accounts ask bank
 * + masked last-4 only (the name derives via accountLabel - the nickname is
 * gone); loans ask name + lender (institution dropdown on statement proof,
 * free-text write-in on owner-declared) + proof; vehicles ask description +
 * year + financed/paid-in-full + proof; other assets keep the typed bucket
 * + proof. Every edit commits straight into the wizard answers, so autosave
 * and resume behave like any other screen.
 */

export const inputCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// ── Institution dropdown + inline add-new ─────────────────────────────────

/**
 * The shared database-list dropdown (I3 banks; J1: also payroll providers,
 * merchant processors, and statement-proof loan lenders). The defaults keep
 * the original bank wording and testids; other lists pass their own labels
 * and testid prefixes. Add-new persists to the backing table and selects
 * the row immediately (same-session).
 */
export function InstitutionSelect({
  institutions,
  selectedId,
  selectedName,
  index,
  onSelect,
  onAdd,
  ariaLabel = 'Bank or card issuer',
  testidPrefix = 'bank',
  listboxLabel = 'Banks',
  selectPlaceholder = 'Select the bank…',
  addToggleLabel = 'Add a new bank…',
  addSubmitLabel = 'Add bank',
  addPlaceholder = 'First Interstate Bank',
  addErrorLabel = 'bank',
}: {
  institutions: InstitutionRow[]
  selectedId?: number | null
  /** Display fallback for free-text/legacy institutions (no id). */
  selectedName?: string | null
  index: number
  onSelect: (institution: InstitutionRow) => void
  /** Returns the created (or deduped) row; null when the add failed. */
  onAdd: (name: string) => Promise<InstitutionRow | null>
  /** Surface-specific trigger label (intake: "Bank or card issuer"; the
      SOP editor: "Institution"). The listbox label stays "Banks". */
  ariaLabel?: string
  testidPrefix?: string
  listboxLabel?: string
  selectPlaceholder?: string
  addToggleLabel?: string
  addSubmitLabel?: string
  addPlaceholder?: string
  addErrorLabel?: string
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
      setError(`Could not add the ${addErrorLabel} - try again.`)
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
        data-testid={`${testidPrefix}-select-${index}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          inputCls,
          'flex items-center justify-between gap-2 text-left',
          currentName == null && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{currentName ?? selectPlaceholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        // The popover holds the listbox AND the inline add-new; the listbox
        // itself owns options only (axe aria-required-children).
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-pop">
          <div role="listbox" aria-label={listboxLabel} className="max-h-64 overflow-auto">
            {institutions.map((i) => {
              const selected = i.id === selectedId
              return (
                <button
                  key={i.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`${testidPrefix}-option-${i.id}`}
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
          </div>
          <div className="border-t border-border">
            {adding ? (
              <form
                className="flex items-center gap-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitNew()
                }}
              >
                <input
                  aria-label={`New ${addErrorLabel} name`}
                  data-testid={`${testidPrefix}-add-input`}
                  className={cn(inputCls, 'h-9')}
                  placeholder={addPlaceholder}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- inline reveal: focus follows the user's click
                  autoFocus
                />
                <Button type="submit" size="sm" disabled={busy || newName.trim() === ''} data-testid={`${testidPrefix}-add-submit`}>
                  {busy ? 'Adding…' : addSubmitLabel}
                </Button>
              </form>
            ) : (
              <button
                type="button"
                data-testid={`${testidPrefix}-add-toggle-${index}`}
                onClick={() => setAdding(true)}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-firm-brand-strong transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {addToggleLabel}
              </button>
            )}
            {error && (
              <p className="px-3 py-1.5 text-xs font-medium text-status-overdue" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Per-type mini-form fields ─────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-medium text-muted-foreground">{children}</span>
}

/** J1 (D1): the masked last-4 input - exactly 4 digits, digits-only as typed. */
function Last4Input({
  index,
  value,
  onChange,
}: {
  index: number
  value: string | null | undefined
  onChange: (last4: string | null) => void
}) {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 4)
  const invalid = digits.length > 0 && digits.length < 4
  return (
    <div>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm tracking-widest text-muted-foreground"
        >
          ···
        </span>
        <input
          aria-label={`Last 4 digits ${index + 1}`}
          aria-invalid={invalid}
          data-testid={`last4-${index}`}
          className={cn(inputCls, 'tnum pl-10 tracking-widest')}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="4411"
          value={digits}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 4)
            onChange(d === '' ? null : d)
          }}
        />
      </div>
      {invalid && (
        <p className="mt-1 text-xs font-medium text-status-overdue" role="alert">
          Exactly 4 digits - the last four on the account.
        </p>
      )}
    </div>
  )
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

  // J1 (D1): money accounts have no name field - the name DERIVES from
  // bank + type + last4 on every edit, so form_data and every downstream
  // surface read the same "Chase Checking · 4411" label.
  const change = (patch: Partial<IntakeAccountInput>) => {
    if (!def.deriveName) {
      onChange(patch)
      return
    }
    const next = { ...item, ...patch }
    const last4 = normalizeLast4(next.last4)
    const institution = next.institution?.trim() ?? ''
    onChange({
      ...patch,
      name: last4 != null && institution !== ''
        ? accountLabel({ institution, accountType: def.accountType, last4 })
        : '',
    })
  }

  return (
    <fieldset
      className="rounded-xl border border-border bg-card p-4"
      data-testid={`account-form-${index}`}
    >
      <legend className="sr-only">Account {index + 1}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden>
          #{index + 1}
          {def.deriveName && (item.name ?? '').trim() !== '' && (
            <span className="tnum truncate normal-case tracking-normal text-foreground" data-testid={`account-label-${index}`}>
              {item.name}
            </span>
          )}
          {item.fromVehicle != null && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground" data-testid={`from-vehicle-${index}`}>
              From the vehicles card
            </span>
          )}
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
        {!def.deriveName && (
          <div className="sm:col-span-2">
            <FieldLabel>{def.nameLabel ?? 'Name'}</FieldLabel>
            <input
              aria-label={`${def.nameLabel ?? 'Name'} ${index + 1}`}
              className={inputCls}
              placeholder={def.namePlaceholder}
              value={item.name ?? ''}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
        )}

        {def.askInstitution && (
          <div>
            <FieldLabel>Bank or card issuer</FieldLabel>
            <InstitutionSelect
              institutions={institutions}
              selectedId={item.institutionId}
              selectedName={item.institution}
              index={index}
              onSelect={(i) => change({ institutionId: i.id, institution: i.name })}
              onAdd={onAddInstitution}
            />
          </div>
        )}

        {def.askLast4 && (
          <div>
            <FieldLabel>Last 4 digits</FieldLabel>
            <Last4Input index={index} value={item.last4} onChange={(last4) => change({ last4 })} />
            {/* K7 (C1/J5): optional during discovery, mandatory at conversion. */}
            {(item.institution == null && item.institutionId == null) || normalizeLast4(item.last4) == null ? (
              <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`account-optional-note-${index}`}>
                Optional for now - required when they become a client.
              </p>
            ) : null}
          </div>
        )}

        {def.askLender && (
          // J1 (D6, 00:21:40-00:22:32): statement-proof loans pick the lender
          // from the institutions table; owner-declared loans take a
          // free-text write-in (a family member) that NEVER enters the bank
          // list. Switching proof clears the other shape's value.
          <div>
            <FieldLabel>Lender</FieldLabel>
            {proof === 'statement' ? (
              <InstitutionSelect
                institutions={institutions}
                selectedId={item.lenderInstitutionId}
                selectedName={item.lender}
                index={index}
                ariaLabel={`Lender ${index + 1}`}
                testidPrefix="lender"
                listboxLabel="Lenders"
                selectPlaceholder="Pick the lender from the bank list…"
                addToggleLabel="Add a new lender…"
                addSubmitLabel="Add lender"
                addPlaceholder="Columbia Bank"
                addErrorLabel="lender"
                onSelect={(i) => onChange({ lenderInstitutionId: i.id, lender: i.name })}
                onAdd={onAddInstitution}
              />
            ) : (
              <input
                aria-label={`Lender ${index + 1}`}
                data-testid={`lender-writein-${index}`}
                className={inputCls}
                placeholder="A name is fine - Uncle Bob"
                value={item.lender ?? ''}
                onChange={(e) =>
                  onChange({ lender: e.target.value || null, lenderInstitutionId: null })
                }
              />
            )}
          </div>
        )}

        {def.askYear && (
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
        )}

        {def.askFinanced && (
          <div>
            <FieldLabel>Financed or paid in full?</FieldLabel>
            <select
              aria-label={`Financed or paid in full ${index + 1}`}
              data-testid={`financed-select-${index}`}
              className={cn(inputCls, 'appearance-none')}
              value={item.financed ?? ''}
              onChange={(e) =>
                onChange({
                  financed: e.target.value === '' ? null : (e.target.value as 'financed' | 'paid'),
                })
              }
            >
              <option value="">Select…</option>
              <option value="financed">Financed - a loan is attached</option>
              <option value="paid">Paid in full</option>
            </select>
          </div>
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
              onChange={(e) => {
                const next = e.target.value as IntakeAccountInput['proofCategory']
                // J1 (D6): switching proof swaps the lender's shape - the
                // bank pick is disabled (write-in) on owner-declared and the
                // write-in never becomes an institution.
                onChange(
                  next === 'statement'
                    ? { proofCategory: next }
                    : { proofCategory: next, lenderInstitutionId: null },
                )
              }}
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
  // L1 (H4, 10_06 00:31:41): account removals confirm first - per-card X and
  // shrinking the count below entered rows alike.
  const [pendingDelete, setPendingDelete] = useState<{ name: string; remove: () => void } | null>(null)

  const updateAt = (index: number, patch: Partial<IntakeAccountInput>) =>
    onCommit(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const removeAt = (index: number) => onCommit(items.filter((_, i) => i !== index))

  const finish = () => {
    // J1: per-item completeness lives in the registry (bank + last-4 on
    // money cards, financed pick on vehicles, lender on loans).
    const itemErr = accountItemError(def, items)
    if (itemErr) {
      setError(itemErr)
      return
    }
    setError(null)
    onAdvance()
  }

  return (
    <div className="space-y-4">
      {/* L2 (B1, 10_06 00:06:03-00:08:30): the count stepper is gone - one
          "Add {item}" button at the bottom of the list, "more like a list
          like you're just adding onto that list." */}
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
              onRemove={() =>
                setPendingDelete({
                  name: item.name || `account ${i + 1}`,
                  remove: () => removeAt(i),
                })
              }
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="add-account"
          onClick={() => {
            setError(null)
            onCommit([...items, { name: '', accountType: def.accountType, proofCategory: def.defaultProof }])
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-firm-brand/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {def.addLabel}
        </button>
        {items.length === 0 && <span className="text-sm text-muted-foreground">None - skip ahead if so</span>}
      </div>

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

      {/* L1 (H4, 10_06 00:31:41): every account removal confirms first. */}
      <ConfirmDeleteDialog
        open={pendingDelete != null}
        itemName={pendingDelete?.name ?? ''}
        consequence={`This removes ${pendingDelete?.name} from the accounts. The estimate's per-account math updates.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          pendingDelete?.remove()
          setPendingDelete(null)
        }}
      />
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Mail, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { Quote } from '@firmos/domain'

import { Button } from '@/components/ui/button'
import { MaskedValue } from '@/components/ui/masked-value'
import { acceptIntakeEstimate, checkDuplicates, submitIntakeForReview } from '@/server/actions/intake'
import type { DuplicateCandidate, IntakeAccountInput } from '@/server/intake'
import { monthLabel } from '@/shared/lib/date-display'
import { maskTaxId } from '@/shared/lib/mask'
import { equitySeedPlan } from '@/shared/lib/account-types'
import { accountLabel, normalizeLast4 } from '@/shared/lib/account-label'
import { ROUTINE_BUCKET_LABELS } from '@/shared/lib/routine-schedule'
import { cn } from '@/shared/lib/utils'
import { CustomWorkAdder } from './custom-work'

import { ConvertDialog, type StaffOption } from './convert-dialog'
import { formatMoney } from './format'
import { noteLabel } from './notes-rail'
import { PriceEditControl } from './price-edit'
import { QuoteEmailCompose } from './quote-email-compose'
import { QuoteTemplateButton } from './quote-template-button'
import {
  BREAKDOWN_ACCOUNTS,
  buildBucketedEstimate,
  lineCycleLabel,
  quoteLineNet,
  type EstimateLine,
} from './review-estimate'
import {
  ACCOUNT_TYPE_LABELS,
  allAccounts,
  ASSET_TYPE_LABELS,
  deriveRoutineTasks,
  PROOF_CATEGORY_LABELS,
  visibleChapters,
  visibleQuestions,
  type ChapterDef,
  type QuestionDef,
  type WizardAnswers,
} from './registry'
import { averageMonthlyStars } from './routine-calendar'

/**
 * The review chapter. J4 (meeting #3, V1-V7) as revised by K6 (09_30
 * 01:00:58, F1 - the confirm-green model):
 *  - F1: every section starts EXPANDED (no one-open-at-a-time accordion);
 *    the top-left confirm checkbox turns the section green and collapses it
 *    to signal "reviewed"; unchecking reopens. Left = complete, right =
 *    edit. When every chapter is confirmed the estimate block greens too.
 *  - V1: every section AND every row carries an edit affordance (hover/
 *    focus reveal, always visible on touch) that opens the question's hero
 *    card in the overlay - never a navigation back into the wizard.
 *  - V4/V5/V6/V7: the quote section is the bucketed estimate - one-time
 *    fees top, recurring grouped by the five routine buckets with per-line
 *    monthly math, retro bottom with a bulk-discount control (K6 D5-D7).
 * Never counted in the "Question X of Y" progress.
 */

// ── I3 grouped accounts (plan §1 screen 7 + §3) ───────────────────────────

/** Display order for the review's account groups. J1 (D4): assets before
 *  loans - the count-card order - then anything exotic (legacy/extraction
 *  types) last. */
const REVIEW_ACCOUNT_TYPE_ORDER = [
  'checking',
  'savings',
  'credit_card',
  'vehicle',
  'fixed_assets',
  'investment',
  'other_asset',
  'vehicle_loan',
  'loan',
]

/** The balance-chapter question that edits each account group (V1). */
const ACCOUNT_GROUP_QUESTION: Record<string, string> = {
  checking: 'checking-accounts',
  savings: 'savings-accounts',
  credit_card: 'credit-cards',
  vehicle: 'vehicles',
  fixed_assets: 'other-assets',
  investment: 'other-assets',
  other_asset: 'other-assets',
  vehicle_loan: 'loans',
  loan: 'loans',
  // L5 (J3): legacy equity rows edit the equity setup question.
  owner_contributions: 'equity-setup',
  owner_distributions: 'equity-setup',
  other_equity: 'equity-setup',
}

/** L5 (J2, 10_06 01:09:04): the accounting-equation boxes - "here's your
 *  assets, here's your liabilities, and here's your equity as individual
 *  sections… a box within the box." */
type BalanceBoxKey = 'assets' | 'liabilities' | 'equity'
const BALANCE_BOX_ORDER: readonly { key: BalanceBoxKey; label: string }[] = [
  { key: 'assets', label: 'Assets' },
  { key: 'liabilities', label: 'Liabilities' },
  { key: 'equity', label: 'Equity' },
]
const TYPE_TO_BOX: Record<string, BalanceBoxKey> = {
  checking: 'assets',
  savings: 'assets',
  credit_card: 'assets',
  vehicle: 'assets',
  fixed_assets: 'assets',
  investment: 'assets',
  other_asset: 'assets',
  vehicle_loan: 'liabilities',
  loan: 'liabilities',
  loans_from_shareholders: 'liabilities',
  owner_contributions: 'equity',
  owner_distributions: 'equity',
  other_equity: 'equity',
}
/** J2: within Assets, current (money) accounts group before long-term. */
const CURRENT_ASSET_TYPES: ReadonlySet<string> = new Set(['checking', 'savings', 'credit_card'])

function accountDetailLine(a: IntakeAccountInput): string | null {
  const parts: string[] = []
  if (a.assetType != null && ASSET_TYPE_LABELS[a.assetType]) parts.push(ASSET_TYPE_LABELS[a.assetType])
  if (a.lender) parts.push(a.lender)
  if (a.year != null) parts.push(String(a.year))
  // J1 (D5): the financed pick shows; "financed" means a linked loan entry
  // already sits in the loans group.
  if (a.financed === 'financed') parts.push('Financed')
  if (a.financed === 'paid') parts.push('Paid in full')
  // Legacy rows only: J1 (D3) removed balance/value capture from intake.
  if (a.balance != null) parts.push(`balance ${formatMoney(a.balance)}`)
  if (a.value != null) parts.push(`value ${formatMoney(a.value)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** One account row: label, detail, badges, edit pencil (V1). */
function AccountRow({
  a,
  type,
  i,
  editable,
  onEdit,
}: {
  a: IntakeAccountInput
  type: string
  i: number
  editable: boolean
  onEdit: (chapterId: string, questionId: string, walk?: boolean) => void
}) {
  const detail = accountDetailLine(a)
  const hasLast4 = normalizeLast4(a.last4) != null
  return (
    <li className="group flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="review-account-row">
      <span className="text-sm font-medium text-foreground">{accountLabel(a)}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      {a.institution && !hasLast4 && (
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
          {a.institution}
        </span>
      )}
      {a.fromVehicle != null && (
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
          Vehicle loan
        </span>
      )}
      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {PROOF_CATEGORY_LABELS[a.proofCategory ?? ''] ?? 'Statement'}
      </span>
      {a.grantLoginAccess === true && (
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
          Online access
        </span>
      )}
      {editable && (
        <RowEditButton
          label={`${ACCOUNT_TYPE_LABELS[type] ?? type} accounts`}
          testid={`edit-account-row-${type}-${i}`}
          onClick={() => onEdit('balance', ACCOUNT_GROUP_QUESTION[type] ?? 'checking-accounts')}
        />
      )}
    </li>
  )
}

/** The per-type group inside a box: type header + count + rows. */
function AccountTypeGroup({
  type,
  list,
  editable,
  onEdit,
}: {
  type: string
  list: IntakeAccountInput[]
  editable: boolean
  onEdit: (chapterId: string, questionId: string, walk?: boolean) => void
}) {
  return (
    <div className="py-1.5" data-testid="review-account-group" data-type={type}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {ACCOUNT_TYPE_LABELS[type] ?? type}
        <span className="tnum ml-1.5">{list.length}</span>
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {list.map((a, i) => (
          <AccountRow key={`${a.name}-${i}`} a={a} type={type} i={i} editable={editable} onEdit={onEdit} />
        ))}
      </ul>
    </div>
  )
}

/** I3: accounts grouped by type, each row carrying its institution and
 *  proof-category badges plus the online-access flag.
 *  J1 (D2): the primary text is the bank -> type -> last4 standard
 *  (accountLabel); legacy rows without a last-4 keep the old name and the
 *  institution badge. J4 (V1): every row edits its type's count card.
 *  L5 (J2): the groups nest inside the accounting-equation boxes - Assets
 *  (current, then long-term), Liabilities, Equity; the Equity box lists the
 *  intake's planned equity accounts (J3) plus any legacy equity rows. */
function ReviewAccounts({
  answers,
  editable,
  onEdit,
}: {
  answers: WizardAnswers
  editable: boolean
  onEdit: (chapterId: string, questionId: string, walk?: boolean) => void
}) {
  const accounts = allAccounts(answers)
  // L5 (J3): the equity accounts conversion will seed, straight from the
  // intake answers; null when the equity question was never answered.
  const equityPlan = equitySeedPlan(answers)
  if (accounts.length === 0 && !equityPlan) return null
  const groups = new Map<string, IntakeAccountInput[]>()
  for (const a of accounts) {
    const t = (a.accountType ?? 'other').trim().toLowerCase()
    const list = groups.get(t) ?? []
    list.push(a)
    groups.set(t, list)
  }
  const typeOrder = (x: string, y: string) => {
    const ix = REVIEW_ACCOUNT_TYPE_ORDER.indexOf(x)
    const iy = REVIEW_ACCOUNT_TYPE_ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
  }
  const boxOf = (box: BalanceBoxKey) =>
    [...groups.entries()]
      .filter(([t]) => (TYPE_TO_BOX[t] ?? 'assets') === box)
      .sort(([x], [y]) => typeOrder(x, y))

  const assetGroups = boxOf('assets')
  const currentAssets = assetGroups.filter(([t]) => CURRENT_ASSET_TYPES.has(t))
  const longTermAssets = assetGroups.filter(([t]) => !CURRENT_ASSET_TYPES.has(t))
  const liabilityGroups = boxOf('liabilities')
  const equityGroups = boxOf('equity')

  return (
    <div className="space-y-3 px-4 py-2.5" data-testid="review-accounts">
      {BALANCE_BOX_ORDER.map(({ key, label }) => {
        if (key === 'assets' && assetGroups.length === 0) return null
        if (key === 'liabilities' && liabilityGroups.length === 0) return null
        return (
          <div
            key={key}
            className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
            data-testid={`balance-box-${key}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground">{label}</p>
            {key === 'assets' && (
              <div className="mt-1 space-y-2">
                {currentAssets.length > 0 && (
                  <div data-testid="balance-box-assets-current">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current</p>
                    <div className="divide-y divide-border/50">
                      {currentAssets.map(([t, list]) => (
                        <AccountTypeGroup key={t} type={t} list={list} editable={editable} onEdit={onEdit} />
                      ))}
                    </div>
                  </div>
                )}
                {longTermAssets.length > 0 && (
                  <div data-testid="balance-box-assets-long-term">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Long-term</p>
                    <div className="divide-y divide-border/50">
                      {longTermAssets.map(([t, list]) => (
                        <AccountTypeGroup key={t} type={t} list={list} editable={editable} onEdit={onEdit} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {key === 'liabilities' && (
              <div className="mt-1 divide-y divide-border/50">
                {liabilityGroups.map(([t, list]) => (
                  <AccountTypeGroup key={t} type={t} list={list} editable={editable} onEdit={onEdit} />
                ))}
              </div>
            )}
            {key === 'equity' && (
              <div className="mt-1" data-testid="balance-box-equity-body">
                {equityGroups.length > 0 && (
                  <div className="divide-y divide-border/50">
                    {equityGroups.map(([t, list]) => (
                      <AccountTypeGroup key={t} type={t} list={list} editable={editable} onEdit={onEdit} />
                    ))}
                  </div>
                )}
                {equityPlan && (
                  <ul className="mt-1 space-y-1" data-testid="equity-plan">
                    {equityPlan.map((row) => (
                      <li key={row.name} className="flex items-baseline gap-2 text-sm" data-testid="equity-plan-row">
                        <span className="font-medium text-foreground">{row.name}</span>
                        <span className="text-[10px] text-muted-foreground">seeds at conversion</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!equityPlan && equityGroups.length === 0 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs italic text-muted-foreground" data-testid="equity-empty">
                    No equity setup yet
                    {editable && (
                      <RowEditButton label="Equity setup" testid="edit-equity" onClick={() => onEdit('balance', 'equity-setup')} />
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** V1: the row-level edit affordance - hover/focus reveal on pointer
 *  devices, always visible on touch. K1 (F2, 09_30 01:00:58): bigger, with
 *  a visible border on reveal - "it's kind of small... more interactive". */
function RowEditButton({
  label,
  testid,
  onClick,
}: {
  label: string
  testid: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      data-testid={testid}
      className="shrink-0 self-center rounded-md border border-transparent p-1.5 text-firm-brand-strong opacity-0 transition-all hover:border-firm-brand/40 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}


/** J1 (D5): a loan entry auto-routed from a financed vehicle carries the
 *  fromVehicle marker - rendered as a "Vehicle loan" badge above. */

// ── V4-V7: the bucketed estimate ──────────────────────────────────────────

/** L4 (G9): the billing-month drop-down's options (full month names). */
const BILLING_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** One recurring estimate line: name, math, optional account breakdown, and
 *  the direct price editor (V4). */
function EstimateLineRow({
  view,
  answers,
  cycle,
  priceEditable,
  onPriceChange,
  breakdownOpen,
  onToggleBreakdown,
  onToggleReconAccount,
  onBillingMonthChange,
}: {
  view: EstimateLine
  answers: WizardAnswers
  cycle: number
  priceEditable: boolean
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
  breakdownOpen: boolean
  onToggleBreakdown: () => void
  /** L4 (G7, 10_06 01:16:53): per-account factor editing on the
   *  reconciliation line - which accounts count toward "4 accounts × $25". */
  onToggleReconAccount?: (label: string, included: boolean) => void
  /** L4 (G9, 10_06 01:21:18): billing-month assignment on annual lines -
   *  "this report's due in January; include it on the January invoice"
   *  (null = back to the monthly spread). */
  onBillingMonthChange?: (serviceKey: string, month: number | null) => void
}) {
  const breakdownFor = BREAKDOWN_ACCOUNTS[view.key]
  const breakdownAccounts = breakdownFor ? breakdownFor(answers) : []
  // L4 (G7): the recon line's factor is editable - which accounts count.
  const factorEditable = view.key === 'account_reconciliations' && priceEditable && onToggleReconAccount != null
  const excludedLabels = new Set((answers.reconExcludedAccounts ?? []).map((n) => n.trim().toLowerCase()))
  // L4 (G9): the assigned billing month (annual lines only; the 1099s'
  // February rule is fixed and keeps its own badge).
  const assignedMonth = answers.billingMonths?.[view.key] ?? null
  const billMonthAssignable =
    view.bucket === 'annual' && !view.februaryBilled && priceEditable && onBillingMonthChange != null
  const net = view.cycleNet
  return (
    <li className="group py-2" data-testid={`estimate-line-${view.key}`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 text-sm text-foreground">
          {view.name}
          {view.februaryBilled && (
            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
              billed each February
            </span>
          )}
          {!view.februaryBilled && assignedMonth != null && (
            <span
              className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground"
              data-testid={`bill-month-badge-${view.key}`}
            >
              billed each {BILLING_MONTH_NAMES[assignedMonth - 1]}
            </span>
          )}
        </span>
        {priceEditable && onPriceChange ? (
          <PriceEditControl
            serviceKey={view.key}
            name={view.name}
            cycleLabel={lineCycleLabel(view.line, cycle)}
            standard={view.standard}
            effective={net}
            deviates={view.overridden || view.discounted}
            onSave={(dollars) => onPriceChange(view.key, dollars)}
          />
        ) : (
          <StaticPrice standard={view.standard} effective={net} deviates={view.overridden || view.discounted} />
        )}
      </div>
      {view.math && (
        <p className="tnum mt-0.5 text-xs text-muted-foreground" data-testid={`estimate-math-${view.key}`}>
          {view.math}
        </p>
      )}
      {/* L4 (G9, 10_06 01:21:18): the billing-month drop-down - "When do we
          bill this? … I should be able to click the drop down here." An
          assigned month bills the full annual quantity on that month's
          invoice; the default spreads it across the year. */}
      {billMonthAssignable && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          Bill
          <select
            aria-label={`Billing month for ${view.name}`}
            data-testid={`bill-month-${view.key}`}
            value={assignedMonth ?? ''}
            onChange={(e) =>
              onBillingMonthChange!(view.key, e.target.value === '' ? null : Number(e.target.value))
            }
            className="rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">spread across the year</option>
            {BILLING_MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                each {name}
              </option>
            ))}
          </select>
        </p>
      )}
      {/* L3 (F5, 10_06 00:30:45): tier-priced lines carry the caveat -
          "pricing may vary based on employee selected." The assigned
          person's actual billing rate applies after conversion (F6). */}
      {view.line.pricedByTiers && (
        <p className="mt-0.5 text-[11px] italic text-muted-foreground" data-testid={`tier-caveat-${view.key}`}>
          Estimated at the difficulty-tier rates - pricing may vary based on the employee selected.
        </p>
      )}
      {/* V5: the itemized account breakdown (count x rate math sits in the
          line above; the actual accounts list here). */}
      {breakdownFor && breakdownAccounts.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={breakdownOpen}
            aria-controls={`breakdown-${view.key}`}
            data-testid={`breakdown-toggle-${view.key}`}
            onClick={onToggleBreakdown}
            className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', breakdownOpen && 'rotate-180')} aria-hidden />
            {breakdownAccounts.length} account{breakdownAccounts.length === 1 ? '' : 's'}
          </button>
          {breakdownOpen && (
            <ul
              id={`breakdown-${view.key}`}
              data-testid={`breakdown-${view.key}`}
              className="mt-1 space-y-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
            >
              {breakdownAccounts.map((a, i) => {
                // L4 (G7): the recon factor is editable - each account
                // includes or excludes itself from the count (the line
                // reprices live).
                const label = accountLabel(a)
                const included = !excludedLabels.has(label.trim().toLowerCase())
                if (!factorEditable) {
                  return (
                    <li key={`${a.name}-${i}`} className="text-xs text-foreground" data-testid="breakdown-account">
                      {label}
                    </li>
                  )
                }
                return (
                  <li key={`${a.name}-${i}`} className="flex items-center gap-2 text-xs" data-testid="breakdown-account">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={included}
                      aria-label={`${included ? 'Exclude' : 'Include'} ${label} in the reconciliation count`}
                      data-testid={`factor-toggle-${label}`}
                      onClick={() => onToggleReconAccount!(label, !included)}
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {included && <Check className="h-2.5 w-2.5 text-firm-brand" aria-hidden />}
                    </button>
                    <span className={cn(included ? 'text-foreground' : 'text-muted-foreground line-through')}>{label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** The read-only price: standard struck through when the line nets down. */
function StaticPrice({
  standard,
  effective,
  deviates,
}: {
  standard: number | null
  effective: number | null
  deviates: boolean
}) {
  if (effective == null) return <span className="text-xs italic text-muted-foreground">quoted at review</span>
  return (
    <span className="shrink-0">
      {deviates && standard != null && (
        <span className="tnum mr-1.5 text-xs font-normal text-muted-foreground line-through">
          {formatMoney(standard)}
        </span>
      )}
      <span className="tnum text-sm font-medium text-foreground">{formatMoney(effective)}</span>
    </span>
  )
}

function EstimateSection({
  quote,
  answers,
  priceEditable,
  onPriceChange,
  onToggleReconAccount,
  onBillingMonthChange,
  onRetroDiscountChange,
  onCustomWork,
  customTaskCatalog,
  onAddCustomTaskTitle,
}: {
  quote: Quote
  answers: WizardAnswers
  priceEditable: boolean
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
  /** L4 (G7): per-account factor editing on the recon line. */
  onToggleReconAccount?: (label: string, included: boolean) => void
  /** L4 (G9): billing-month assignment on annual lines. */
  onBillingMonthChange?: (serviceKey: string, month: number | null) => void
  /** K6 (D6): the retro bulk-discount percent (null clears it). */
  onRetroDiscountChange?: (percent: number | null) => void
  /** K6 (D3/D4): custom one-time or recurring work added from the review. */
  onCustomWork?: (patch: Partial<WizardAnswers>) => void
  /** K3: persist the custom task title to the shared catalog list. */
  onAddCustomTaskTitle?: (name: string) => void
  customTaskCatalog?: { id: number; name: string }[]
}) {
  // L4 (G5, 10_06 01:15:27): the retro block splits per YEAR (default) or
  // per quarter - "compartmentalized by year… or by whatever frequency."
  const [retroSplit, setRetroSplit] = useState<'year' | 'quarter'>('year')
  const estimate = buildBucketedEstimate(quote, answers, retroSplit)
  // V5: breakdowns toggle independently of the section accordion (V2).
  const [openBreakdowns, setOpenBreakdowns] = useState<Record<string, boolean>>({})
  // D6: the retro bulk-discount input's local text (commits on blur/Enter).
  const [retroPct, setRetroPct] = useState(
    estimate.retroDiscountPercent != null ? String(estimate.retroDiscountPercent) : '',
  )

  return (
    <div data-testid="estimate">
      {/* K6 (D5): one-time fees FIRST, recurring buckets in the middle, the
          retro block at the BOTTOM - "one-time fees at the top, recurring in
          the middle, retroactive at the end" (01:02:53). */}
      {estimate.oneTime.length > 0 && (
        <div className="px-4 py-2.5" data-testid="estimate-one-time">
          <p className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            One-time fees
            <span className="tnum font-normal normal-case tracking-normal" data-testid="one-time-total">
              {formatMoney(estimate.oneTimeTotal)}
            </span>
          </p>
          <ul className="mt-1 divide-y divide-border/60">
            {estimate.oneTime.map((item) => (
              <li key={item.key} className="group py-2" data-testid={`one-time-${item.key}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 text-sm text-foreground">{item.name}</span>
                  {priceEditable && onPriceChange ? (
                    <PriceEditControl
                      serviceKey={item.key}
                      name={item.name}
                      cycleLabel="one-time"
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                      onSave={(dollars) => onPriceChange(item.key, dollars)}
                    />
                  ) : (
                    <StaticPrice
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                    />
                  )}
                </div>
                {item.math && (
                  <p className="tnum mt-0.5 text-xs text-muted-foreground" data-testid={`one-time-math-${item.key}`}>
                    {item.math}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {estimate.groups.length > 0 && (
        <div className="divide-y divide-border px-4" data-testid="estimate-recurring">
          {estimate.groups.map((group) => (
            <div key={group.bucket} className="py-2.5" data-testid={`estimate-bucket-${group.bucket}`}>
              <p className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {ROUTINE_BUCKET_LABELS[group.bucket]}
                <span className="tnum font-normal normal-case tracking-normal" data-testid={`estimate-bucket-total-${group.bucket}`}>
                  {/* L4 (G2): cadence buckets total at their own cadence -
                      quarterly/annual are never amortized into /mo. */}
                  {group.bucket === 'quarterly'
                    ? `${formatMoney(group.perYear)}/quarter`
                    : group.bucket === 'annual'
                      ? `${formatMoney(group.perYear)}/yr`
                      : `${formatMoney(group.perMonth)}/mo`}
                </span>
              </p>
              <ul className="mt-1 divide-y divide-border/60">
                {group.lines.map((view) => (
                  <EstimateLineRow
                    key={view.key}
                    view={view}
                    answers={answers}
                    cycle={estimate.billingCycle}
                    priceEditable={priceEditable}
                    onPriceChange={onPriceChange}
                    breakdownOpen={openBreakdowns[view.key] === true}
                    onToggleBreakdown={() =>
                      setOpenBreakdowns((o) => ({ ...o, [view.key]: !o[view.key] }))
                    }
                    onToggleReconAccount={onToggleReconAccount}
                    onBillingMonthChange={onBillingMonthChange}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {estimate.unpricedRecurringCount > 0 && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {estimate.unpricedRecurringCount} item{estimate.unpricedRecurringCount === 1 ? '' : 's'} priced at
          review, not live
        </p>
      )}

      {/* K6 (D5/D6/D7): the retro block at the bottom - cleanup + missed
          filings, with Jason's bulk discount on the whole block. L4 (G5):
          per-period priced lines, split by year or quarter. */}
      {estimate.retroItems.length > 0 && (
        <div className="border-t border-border px-4 py-2.5" data-testid="estimate-retro">
          <p className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>
              Retroactive cleanup
              {/* L4 (G5): year/quarter split toggle. */}
              <span className="ml-2 inline-flex overflow-hidden rounded-md border border-border align-middle normal-case tracking-normal">
                {(['year', 'quarter'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={retroSplit === mode}
                    data-testid={`retro-split-${mode}`}
                    onClick={() => setRetroSplit(mode)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      retroSplit === mode ? 'bg-firm-brand text-white' : 'bg-card text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    {mode === 'year' ? 'By year' : 'By quarter'}
                  </button>
                ))}
              </span>
            </span>
            <span className="tnum font-normal normal-case tracking-normal" data-testid="retro-total">
              {formatMoney(estimate.retroTotal)}
            </span>
          </p>
          <ul className="mt-1 divide-y divide-border/60">
            {estimate.retroItems.map((item) => (
              <li key={item.key} className="group py-2" data-testid={`retro-${item.key}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 text-sm text-foreground">{item.name}</span>
                  {priceEditable && onPriceChange ? (
                    <PriceEditControl
                      serviceKey={item.key}
                      name={item.name}
                      cycleLabel="one-time"
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                      onSave={(dollars) => onPriceChange(item.key, dollars)}
                    />
                  ) : (
                    <StaticPrice
                      standard={item.standard}
                      effective={item.amount}
                      deviates={item.overridden}
                    />
                  )}
                </div>
                {item.math && (
                  <p className="tnum mt-0.5 text-xs text-muted-foreground" data-testid={`one-time-math-${item.key}`}>
                    {item.math}
                  </p>
                )}
                {item.periods && item.periods.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground" data-testid="retro-periods">
                    {item.periods
                      .map((p) => `${p.label}: ${p.months} month${p.months === 1 ? '' : 's'}`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {/* D6: "I usually give a discount on the retroactive stuff... a bulk
              discount" (01:06:06) - percent off the whole retro block. */}
          {priceEditable && onRetroDiscountChange && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="retro-discount" className="text-xs text-muted-foreground">
                Bulk discount on retroactive work
              </label>
              <input
                id="retro-discount"
                data-testid="retro-discount"
                className="tnum h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                inputMode="numeric"
                placeholder="0"
                value={retroPct}
                onChange={(e) => setRetroPct(e.target.value)}
                onBlur={() => {
                  const n = retroPct.trim() === '' ? null : Number(retroPct)
                  if (n == null || (Number.isFinite(n) && n >= 0 && n <= 100)) {
                    onRetroDiscountChange(n)
                  } else {
                    setRetroPct(estimate.retroDiscountPercent != null ? String(estimate.retroDiscountPercent) : '')
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          )}
        </div>
      )}
      {quote.billingCycle > 1 && (
        <p className="px-4 pb-2.5 text-[11px] text-muted-foreground">
          Billed every {quote.billingCycle} months - shown at the effective monthly rate.
        </p>
      )}
      {/* K6 (D4, 09_30 01:08:26): custom one-time or recurring work enters
          from the services review area - "that's where the services review
          area, we would have the option to enter in custom one time or
          custom recurring." */}
      {priceEditable && onCustomWork && (
        <div className="border-t border-border px-4 py-3" data-testid="estimate-custom-work">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Custom work
          </p>
          <CustomWorkAdder answers={answers} onApply={onCustomWork} onAddToCatalog={onAddCustomTaskTitle} catalog={customTaskCatalog} />
        </div>
      )}
    </div>
  )
}

/** An open section's body: the estimate, running notes, grouped accounts,
 *  or the chapter's answer rows (each with its V1 edit affordance). */
function SectionBody({
  section,
  quote,
  answers,
  editable,
  onEdit,
  onPriceChange,
  onToggleReconAccount,
  onBillingMonthChange,
  onRetroDiscountChange,
  onCustomWork,
  customTaskCatalog,
  onAddCustomTaskTitle,
}: {
  section: SectionDef
  quote: Quote | null
  answers: WizardAnswers
  editable: boolean
  onEdit: (chapterId: string, questionId: string, walk?: boolean) => void
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
  /** L4 (G7): per-account factor editing on the recon line. */
  onToggleReconAccount?: (label: string, included: boolean) => void
  /** L4 (G9): billing-month assignment on annual lines. */
  onBillingMonthChange?: (serviceKey: string, month: number | null) => void
  onRetroDiscountChange?: (percent: number | null) => void
  onCustomWork?: (patch: Partial<WizardAnswers>) => void
  customTaskCatalog?: { id: number; name: string }[]
  onAddCustomTaskTitle?: (name: string) => void
}) {
  if (section.kind === 'quote') {
    if (!quote) return null
    return (
      <EstimateSection
        quote={quote}
        answers={answers}
        priceEditable={editable && onPriceChange != null}
        onPriceChange={onPriceChange}
        onToggleReconAccount={onToggleReconAccount}
        onBillingMonthChange={onBillingMonthChange}
        onRetroDiscountChange={onRetroDiscountChange}
        onCustomWork={onCustomWork}
        customTaskCatalog={customTaskCatalog}
        onAddCustomTaskTitle={onAddCustomTaskTitle}
      />
    )
  }
  if (section.kind === 'notes') {
    /* Running notes captured mid-wizard ride along to the review and, at
        conversion, into the client's notes. */
    return (
      <ul className="divide-y divide-border px-4" data-testid="review-running-notes">
        {(answers.runningNotes ?? []).map((n, i) => (
          <li key={`${n.at}-${i}`} className="py-2.5" data-testid="running-note">
            <p className="text-sm text-foreground">{n.text}</p>
            <p className="tnum mt-0.5 text-[11px] text-muted-foreground">{noteLabel(n.at)}</p>
          </li>
        ))}
      </ul>
    )
  }
  if (section.chapter.id === 'balance') {
    return <ReviewAccounts answers={answers} editable={editable} onEdit={onEdit} />
  }
  return (
    <dl className="divide-y divide-border px-4">
      {section.questions
        .map((q) => ({ q, text: q.summarize(answers) }))
        .filter((r): r is { q: QuestionDef; text: string } => r.text != null)
        .map(({ q, text }) => (
          <div key={q.id} className="group flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-xs text-muted-foreground">{q.title}</dt>
            <dd className="flex items-baseline gap-1.5 text-right text-sm text-foreground">
              {/* L5 (J1, 10_06 01:07:49): the EIN masks password-style with a
                  hide/unhide toggle - "we can verify what that is." */}
              {q.id === 'tax-id' && typeof answers.taxId === 'string' && answers.taxId.trim() !== '' ? (
                <MaskedValue
                  value={answers.taxId}
                  masked={maskTaxId(answers.taxId)}
                  label="EIN"
                  testid="review-ein"
                />
              ) : (
                <span className="whitespace-pre-line">{text}</span>
              )}
              {editable && (
                <RowEditButton
                  label={q.title}
                  testid={`edit-row-${q.id}`}
                  onClick={() => onEdit(section.chapter.id, q.id)}
                />
              )}
            </dd>
          </div>
        ))}
    </dl>
  )
}

// ── The section model (V2 accordion) ──────────────────────────────────────

type SectionDef =
  | { kind: 'chapter'; id: string; chapter: ChapterDef; questions: QuestionDef[] }
  | { kind: 'quote'; id: 'quote' }
  | { kind: 'notes'; id: 'notes' }

type Phase = 'review' | 'duplicates' | 'submitted'

export function ReviewScreen({
  intakeId,
  answers,
  quote,
  status,
  canConvert,
  managers,
  bookkeepers,
  clientId,
  onEdit,
  onPriceChange,
  onToggleReconAccount,
  onBillingMonthChange,
  onRetroDiscountChange,
  onCustomWork,
  customTaskCatalog,
  onAddCustomTaskTitle,
}: {
  intakeId: number
  answers: WizardAnswers
  quote: Quote | null
  status: 'draft' | 'pending_review' | 'accepted' | 'completed' | 'archived'
  canConvert: boolean
  managers: StaffOption[]
  bookkeepers: StaffOption[]
  clientId: number | null
  /** V1: opens the question's hero card in the edit overlay (never navigates). */
  onEdit: (chapterId: string, questionId: string, walk?: boolean) => void
  /** V4: direct per-line price editing; present only on the editable review. */
  onPriceChange?: (serviceKey: string, dollars: number | null) => void
  /** L4 (G7): per-account factor editing on the recon line. */
  onToggleReconAccount?: (label: string, included: boolean) => void
  /** L4 (G9): billing-month assignment on annual lines (editable review). */
  onBillingMonthChange?: (serviceKey: string, month: number | null) => void
  /** K6 (D6): retro bulk-discount percent writer (editable review only). */
  onRetroDiscountChange?: (percent: number | null) => void
  /** K6 (D3/D4): custom work writer (editable review only). */
  onCustomWork?: (patch: Partial<WizardAnswers>) => void
  /** K3: custom task titles catalog for the type-ahead. */
  customTaskCatalog?: { id: number; name: string }[]
  onAddCustomTaskTitle?: (name: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('review')
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  // L4 (K1): the proposal compose dialog (prefilled default, edit per send).
  const [composeOpen, setComposeOpen] = useState(false)
  // L6 (I3): the acceptance gate - conversion opens once the estimate is
  // accepted; accepting flips the page's status server-side. The wizard's
  // liveStatus is frozen at mount, so a successful accept also flips the
  // local mirror (acceptedLocally) - the refresh then confirms it.
  const [accepting, setAccepting] = useState(false)
  const [acceptedLocally, setAcceptedLocally] = useState(false)
  // The wizard's liveStatus is frozen at mount, so submit/accept mirror the
  // server flips locally; router.refresh() then confirms them.
  const [submittedLocally, setSubmittedLocally] = useState(false)
  const effectiveStatus =
    acceptedLocally || status === 'accepted'
      ? 'accepted'
      : submittedLocally
        ? 'pending_review'
        : status
  const isAccepted = effectiveStatus === 'accepted'
  const router = useRouter()
  const acceptEstimate = async () => {
    setAccepting(true)
    try {
      const res = await acceptIntakeEstimate(intakeId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Estimate marked accepted - conversion is open.')
      setAcceptedLocally(true)
      // From the success screen, return to the review so the accepted state
      // (convert unlocked) shows immediately; the refresh confirms it.
      if (phase === 'submitted') setPhase('review')
      router.refresh()
    } finally {
      setAccepting(false)
    }
  }
  // K6 (F1, 09_30 01:00:58-01:02:53): the confirm-green model replaces the
  // V2 accordion - "It should default to all of them being open... you click
  // a check mark and it turns it green. Boom. And it closes it... when
  // you're done they're all green." Left = complete (green), right = edit.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // D8 (01:07:50): after the first proposal send the button reads Resend.
  const [proposalSent, setProposalSent] = useState(false)

  const editable = status === 'draft'

  // L6 (I1, 10_06 00:53:44): the average month's stars beside the estimate
  // price - the price↔workload gut check ("450 on 10 stars, always burnt").
  const starsPerMonth = useMemo(() => {
    const schedule = answers.routineSchedule
    if (!schedule || Object.keys(schedule).length === 0) return null
    const year = new Date().getFullYear()
    const stars = averageMonthlyStars(deriveRoutineTasks(answers), schedule, year)
    return stars > 0 ? stars : null
  }, [answers])

  // ── The section list, in display order: chapters, then the estimate,
  //    then running notes. ──
  const sections: SectionDef[] = []
  for (const chapter of visibleChapters(answers)) {
    const questions = visibleQuestions(chapter, answers)
    const rows = questions
      .map((q) => ({ q, text: q.summarize(answers) }))
      .filter((r) => r.text != null)
    // I3: the balance chapter's rows all fold into the grouped accounts
    // section; render it whenever accounts exist. L5 (J3): an answered
    // equity setup also keeps the section (the Equity box lists the plan).
    const isAccountsChapter = chapter.id === 'balance'
    if (rows.length === 0 && !isAccountsChapter) continue
    if (isAccountsChapter && allAccounts(answers).length === 0 && !answers.equitySetup) continue
    sections.push({ kind: 'chapter', id: chapter.id, chapter, questions })
  }
  if (quote && quote.lines.length > 0) {
    sections.push({ kind: 'quote', id: 'quote' })
  }
  if ((answers.runningNotes ?? []).length > 0) {
    sections.push({ kind: 'notes', id: 'notes' })
  }

  const isOpen = (id: string) => !confirmed.has(id) && !collapsed.has(id)
  // The chevron manually collapses/expands without touching the review state.
  const toggleSection = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // The confirm check: green + collapse; uncheck reopens (and ungreens).
  const toggleConfirm = (id: string) =>
    setConfirmed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // "...when you're done they're all green. And then the final estimate at
  // the bottom thing turns green." The estimate greens itself once every
  // chapter section is confirmed.
  const chapterIds = sections.filter((s) => s.kind === 'chapter').map((s) => s.id)
  const allChaptersConfirmed = chapterIds.length > 0 && chapterIds.every((id) => confirmed.has(id))

  /** V2's collapsed one-liner, per section. */
  const summaryFor = (section: SectionDef): string | null => {
    if (section.kind === 'quote') {
      if (!quote) return null
      // L4 (G3, 10_06 01:14:26): the condensed panel mirrors the grouped
      // estimate - one-time top, the five frequency buckets middle, retro
      // bottom; cadence totals at their own cadence (never amortized).
      const estimate = buildBucketedEstimate(quote, answers)
      const parts: string[] = []
      if (estimate.oneTimeTotal > 0 || estimate.oneTime.length > 0) parts.push(`One-time ${formatMoney(estimate.oneTimeTotal)}`)
      for (const g of estimate.groups) {
        if (g.bucket === 'daily') parts.push(`Daily ${formatMoney(g.perMonth)}/mo`)
        else if (g.bucket === 'weekly') parts.push(`Weekly ${formatMoney(g.perMonth)}/mo`)
        else if (g.bucket === 'monthly') parts.push(`Monthly ${formatMoney(g.perMonth)}/mo`)
        else if (g.bucket === 'quarterly') parts.push(`Quarterly ${formatMoney(g.perYear)}/quarter`)
        else if (g.bucket === 'annual') parts.push(`Annual ${formatMoney(g.perYear)}/yr`)
      }
      if (estimate.retroTotal > 0 || estimate.retroItems.length > 0) parts.push(`Retro ${formatMoney(estimate.retroTotal)}`)
      return parts.length > 0 ? parts.join(' · ') : `${formatMoney(quote.totals.effectiveMonthly)}/mo effective`
    }
    if (section.kind === 'notes') {
      const n = (answers.runningNotes ?? []).length
      return `${n} note${n === 1 ? '' : 's'}`
    }
    if (section.chapter.id === 'balance') {
      const counts = new Map<string, number>()
      for (const a of allAccounts(answers)) {
        const t = (a.accountType ?? 'other').trim().toLowerCase()
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
      return [...counts.entries()]
        .map(([t, n]) => `${n} ${ACCOUNT_TYPE_LABELS[t] ?? t}`)
        .join(' · ')
    }
    const rows = section.questions
      .map((q) => ({ text: q.summarize(answers) }))
      .filter((r): r is { text: string } => r.text != null)
    if (rows.length === 0) return null
    return rows.length > 1 ? `${rows[0].text} · +${rows.length - 1} more` : rows[0].text
  }

  const titleFor = (section: SectionDef): string =>
    section.kind === 'quote' ? 'Estimate' : section.kind === 'notes' ? 'Running notes' : section.chapter.label

  // L4 (K1, 10_06 01:01:28): the proposal email composes before sending -
  // the dialog prefills the rendered default copy, edits are per-send.

  const submit = async (force: boolean) => {
    setBusy(true)
    setError(null)
    if (!force) {
      const dup = await checkDuplicates({ legalName: answers.legalName, taxId: answers.taxId })
      if (!dup.ok) {
        setBusy(false)
        setError(dup.error)
        return
      }
      if (dup.data.length > 0) {
        setBusy(false)
        setDuplicates(dup.data)
        setPhase('duplicates')
        return
      }
    }
    const res = await submitIntakeForReview(intakeId)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSubmittedLocally(true)
    setPhase('submitted')
  }

  if (status === 'completed' && clientId != null) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center" data-testid="converted-state">
        <CheckCircle2 className="mx-auto h-8 w-8 text-status-on-track" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
          This intake is converted
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers stay editable here and cascade to the client record.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/clients/${clientId}`}>
            Open the client
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    )
  }

  if (phase === 'submitted') {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center" data-testid="submitted-success">
        <CheckCircle2 className="mx-auto h-8 w-8 text-status-on-track" aria-hidden />
        <h2 className="mt-3 font-display text-lg font-semibold text-foreground">
          Submitted for review
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {answers.legalName} is in the review queue. Once the client accepts the estimate, a
          manager can convert it to a client.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          {/* L6 (I3): the gate holds on the success screen too - acceptance
              first, conversion after (00:58:22). */}
          {canConvert && (
            <>
              <Button
                variant="action"
                onClick={() => void acceptEstimate()}
                disabled={accepting}
                data-testid="accept-estimate"
              >
                {accepting ? 'Marking…' : 'Mark estimate accepted'}
              </Button>
              <Button variant="outline" disabled data-testid="convert-button" aria-disabled="true">
                Convert to client
              </Button>
            </>
          )}
          <Button asChild variant="outline">
            <Link href="/intake">Back to intakes</Link>
          </Button>
        </div>
        {canConvert && (
          <ConvertDialog
            intakeId={intakeId}
            intakeName={answers.legalName ?? 'this intake'}
            managers={managers}
            bookkeepers={bookkeepers}
            open={convertOpen}
            onOpenChange={setConvertOpen}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="review-screen">
      {/* K6 (D8, 09_30 01:07:50): the proposal email lives top-right -
          "that'll be your resend." After the first send it reads Resend. */}
      {(effectiveStatus === 'draft' || effectiveStatus === 'pending_review' || effectiveStatus === 'accepted') && canConvert && quote != null && phase === 'review' && (
        <div className="flex justify-end gap-2">
          {/* K8 (D8): the email template options ride the same top-right row. */}
          <QuoteTemplateButton />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="email-proposal"
            onClick={() => setComposeOpen(true)}
          >
            <Mail className="h-3.5 w-3.5" aria-hidden />
            {proposalSent ? 'Resend proposal' : 'Email proposal'}
          </Button>
        </div>
      )}
      <QuoteEmailCompose
        intakeId={intakeId}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={() => setProposalSent(true)}
      />
      <div className="space-y-4">
        {sections.map((section) => {
          const isConfirmed = confirmed.has(section.id)
          // K6 (F1): all sections default open; confirm greens + collapses.
          const open = isOpen(section.id)
          // The estimate greens itself once every chapter is confirmed.
          const greened = isConfirmed || (section.kind === 'quote' && allChaptersConfirmed)
          const title = titleFor(section)
          const summary = summaryFor(section)
          const first = section.kind === 'chapter' ? section.questions[0] : undefined
          return (
            <section
              key={section.id}
              className={cn(
                'rounded-xl border bg-card transition-colors duration-200',
                greened ? 'border-status-on-track bg-status-on-track-bg/30' : 'border-border',
              )}
              data-chapter={section.kind === 'chapter' ? section.chapter.id : undefined}
              data-confirmed={greened || undefined}
              data-testid={section.kind === 'quote' ? 'review-quote' : `review-section-${section.id}`}
            >
              <div
                className={cn(
                  'flex items-center gap-1 px-4 py-2.5',
                  open && 'border-b border-border',
                )}
              >
                {/* K6 (F1): the confirm check on the left - "left side is
                    complete, right side is not complete" (edit stays right). */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isConfirmed}
                  aria-label={`Mark ${title} reviewed`}
                  data-testid={`section-confirm-${section.id}`}
                  onClick={() => toggleConfirm(section.id)}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    isConfirmed
                      ? 'border-status-on-track bg-status-on-track text-white'
                      : 'border-input bg-card hover:border-firm-brand/60',
                  )}
                >
                  {isConfirmed && <Check className="h-3.5 w-3.5" aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`review-panel-${section.id}`}
                  data-testid={`section-toggle-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {title}
                      {section.kind === 'notes' && (
                        <span className="tnum ml-1.5">{(answers.runningNotes ?? []).length}</span>
                      )}
                    </span>
                    {!open && summary && (
                      <span
                        className="mt-0.5 block truncate text-xs normal-case tracking-normal text-muted-foreground"
                        data-testid={`section-summary-${section.id}`}
                      >
                        {summary}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </button>
                <span className="flex shrink-0 items-center gap-2">
                  {section.kind === 'quote' && quote && (
                    <span className="tnum text-sm font-semibold text-money-strong" data-testid="quote-total">
                      {formatMoney(quote.totals.effectiveMonthly)}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">/mo effective</span>
                      {/* L6 (I1, 10_06 00:53:44): the workload figure beside
                          the price - "every time I've done 450 on 10 stars
                          I've been burnt." One star = one scheduled task
                          occurrence; the average month's count. */}
                      {starsPerMonth != null && (
                        <span
                          className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-foreground"
                          data-testid="quote-stars"
                          title="One star = one scheduled task occurrence; the average month's total across a year."
                        >
                          ≈ {starsPerMonth} ★/mo
                        </span>
                      )}
                    </span>
                  )}
                  {section.kind === 'chapter' && editable && first && (
                    <button
                      type="button"
                      onClick={() => onEdit(section.chapter.id, first.id, true)}
                      data-testid={`edit-${section.chapter.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-firm-brand-strong transition-colors hover:text-firm-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Edit
                    </button>
                  )}
                </span>
              </div>

              {open && (
                <div id={`review-panel-${section.id}`}>
                  <SectionBody
                    section={section}
                    quote={quote}
                    answers={answers}
                    editable={editable}
                    onEdit={onEdit}
                    onPriceChange={onPriceChange}
                    onToggleReconAccount={onToggleReconAccount}
                    onBillingMonthChange={onBillingMonthChange}
                    onRetroDiscountChange={onRetroDiscountChange}
                    onCustomWork={onCustomWork}
                    customTaskCatalog={customTaskCatalog}
                    onAddCustomTaskTitle={onAddCustomTaskTitle}
                  />
                </div>
              )}
            </section>
          )
        })}
      </div>

      {phase === 'duplicates' && (
        <div
          className="rounded-xl border border-status-due-soon bg-status-due-soon-bg p-4"
          role="alert"
          data-testid="duplicate-warning"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-due-soon" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                Possible duplicate{duplicates.length === 1 ? '' : 's'} found
              </h3>
              <ul className="mt-2 space-y-1">
                {duplicates.map((d) => (
                  <li key={d.id} className="text-sm text-foreground">
                    <span className="font-medium">{d.dbaName ?? d.legalName}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      matches on {d.matchedOn === 'tax_id' ? 'tax ID (EIN)' : 'business name'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-3">
                <Button onClick={() => submit(true)} disabled={busy} data-testid="submit-anyway">
                  {busy ? 'Submitting…' : 'Submit anyway'}
                </Button>
                <Button variant="outline" onClick={() => setPhase('review')} disabled={busy}>
                  Go back
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      {status === 'draft' && !submittedLocally && phase === 'review' && (
        <Button variant="action" onClick={() => submit(false)} disabled={busy} data-testid="submit-intake">
          {busy ? 'Checking…' : 'Submit for review'}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      )}

      {effectiveStatus === 'pending_review' && phase === 'review' && (
        <div className="flex flex-wrap items-center gap-3" data-testid="pending-review-actions">
          {canConvert ? (
            <>
              {/* L6 (I3, 10_06 00:58:22): the estimate must be ACCEPTED
                  before conversion - "we're not going to commit to a day of
                  the week schedule until the estimate is accepted." */}
              <Button
                variant="action"
                onClick={() => void acceptEstimate()}
                disabled={accepting}
                data-testid="accept-estimate"
              >
                {accepting ? 'Marking…' : 'Mark estimate accepted'}
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="convert-gated-hint">
                Conversion opens once the client accepts the estimate - the day-of-week schedule
                finalizes then.
              </span>
              <Button variant="outline" disabled data-testid="convert-button" aria-disabled="true">
                Convert to client
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting on a manager to review and convert.
            </p>
          )}
          <Button asChild variant="outline">
            <Link href="/intake">Back to intakes</Link>
          </Button>
        </div>
      )}

      {isAccepted && phase === 'review' && (
        <div className="flex flex-wrap items-center gap-3" data-testid="accepted-actions">
          <span
            className="rounded bg-status-on-track-bg px-2 py-1 text-[11px] font-semibold text-status-on-track"
            data-testid="accepted-badge"
          >
            Estimate accepted
          </span>
          {canConvert ? (
            <Button variant="action" onClick={() => setConvertOpen(true)} data-testid="convert-button">
              Convert to client
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Accepted - waiting on a manager to convert.
            </p>
          )}
          <Button asChild variant="outline">
            <Link href="/intake">Back to intakes</Link>
          </Button>
        </div>
      )}

      {canConvert && (
        <ConvertDialog
          intakeId={intakeId}
          intakeName={answers.legalName ?? 'this intake'}
          managers={managers}
          bookkeepers={bookkeepers}
          open={convertOpen}
          onOpenChange={setConvertOpen}
        />
      )}
    </div>
  )
}

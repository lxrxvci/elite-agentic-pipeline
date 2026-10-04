import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { Quote } from '@firmos/domain'

import {
  deriveRoutineTasks,
  findQuestion,
  ownershipAddError,
  type QuestionDef,
  type WizardAnswers,
} from '../registry'
import { QuestionScreen } from '../screens'
import { RoutineCalendar } from '../routine-calendar'
import { buildBucketedEstimate } from '../review-estimate'
import { QuoteTemplateButton } from '../quote-template-button'
import { resolveRoutineEntries } from '@/shared/lib/routine-schedule'

/**
 * K8 remediation pins (meeting 09_30 audit closeout):
 *  - B1 ownership cap fires at ADD time and names the remaining %
 *  - C10 record-deposits mirrors record-bills end to end
 *  - E9 the EOY tax checklist seeds annually for every bookkeeping client
 *  - J13 daily custom work normalizes to monthly math (x 22 days)
 *  - E1 the scheduling calendar drills into a day's tasks
 *  - D8 the proposal-email template action lives top-right of the review
 */

// ── B1 ──

describe('B1: ownership_error_shows_remaining (09_30 00:04:41)', () => {
  it('names the remaining available %', () => {
    expect(ownershipAddError([{ ownershipPercent: 75 }], { ownershipPercent: 45 })).toBe(
      "Ownership can't go over 100% — the others already take 75%, so this one can be at most 25%.",
    )
    expect(ownershipAddError([{ ownershipPercent: 75 }], { ownershipPercent: 25 })).toBeNull()
    expect(ownershipAddError([], { ownershipPercent: 101 })).toContain('at most 100%')
    expect(ownershipAddError([{ ownershipPercent: 75 }], {})).toBeNull()
  })

  it('the add is refused at ADD time - the over-cap owner never lands', () => {
    const ownersQ = findQuestion('entity', 'owners')!
    function Harness() {
      const [answers, setAnswers] = useState<WizardAnswers>({
        taxStructure: 'S Corporation',
        owners: [{ name: 'Matt Becker', ownershipPercent: 75 }],
      })
      return (
        <div>
          <QuestionScreen
            q={ownersQ}
            answers={answers}
            onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
            onAdvance={() => {}}
            onPickOption={() => {}}
          />
          <pre data-testid="answers">{JSON.stringify(answers)}</pre>
        </div>
      )
    }
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Jason Yecny' } })
    fireEvent.change(screen.getByLabelText(/ownership %/i), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    expect(screen.getByRole('alert').textContent).toContain('at most 25%')
    const answers = JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
    expect(answers.owners).toHaveLength(1)
  })
})

// ── C10 ──

describe('C10: record_deposits_mirrors_bills (09_30 00:34:07)', () => {
  const base: WizardAnswers = { legalName: 'Dep Co', engagementType: 'bookkeeping' }

  it('the income question derives the weekly routine task like record-bills does', () => {
    const withDeposits = deriveRoutineTasks({ ...base, recordDeposits: true } as WizardAnswers)
    const depositTask = withDeposits.find((t) => t.key === 'record-deposits')
    expect(depositTask).toBeTruthy()
    expect(depositTask?.title).toMatch(/deposit/i)
    expect(depositTask?.defaultEntry?.bucket).toBe('weekly')

    const withBills = deriveRoutineTasks({ ...base, recordBills: true } as WizardAnswers)
    const billsTask = withBills.find((t) => t.key === 'record-bills')
    expect(billsTask).toBeTruthy()
    // Same shape: the deposits task sits in the bank-throughput phase with bills.
    expect(depositTask?.assignee).toBe(billsTask?.assignee)

    expect(deriveRoutineTasks(base).find((t) => t.key === 'record-deposits')).toBeUndefined()
  })

  it('the question writes the BOOLEAN the quote and scheduler read (K8 wiring fix)', () => {
    const q = findQuestion('income', 'record-deposits')!
    expect(q).toBeTruthy()
    expect(q.apply(base, 'yes')).toEqual({ recordDeposits: true })
    expect(q.apply(base, 'no')).toEqual({ recordDeposits: false })
    expect(q.get({ ...base, recordDeposits: true } as WizardAnswers)).toBe('yes')
  })

  it('a legacy string answer still derives (tolerant read)', () => {
    const tasks = deriveRoutineTasks({ ...base, recordDeposits: 'yes' } as unknown as WizardAnswers)
    expect(tasks.find((t) => t.key === 'record-deposits')).toBeTruthy()
  })
})

// ── E9 ──

describe('E9: eoy_checklist_seeds_annually (09_30 00:59:13)', () => {
  it('every bookkeeping engagement derives the annual year-end tax checklist', () => {
    const tasks = deriveRoutineTasks({ legalName: 'EOY Co', engagementType: 'bookkeeping' } as WizardAnswers)
    const eoy = tasks.find((t) => t.key === 'eoy-tax-checklist')
    expect(eoy).toBeTruthy()
    expect(eoy?.defaultEntry?.bucket).toBe('annual')
    expect(eoy?.title).toMatch(/tax/i)
    // The checklist carries its subtasks (verify-everything review).
    expect((eoy?.subtasks ?? []).length).toBeGreaterThan(0)
  })

  it('a consulting engagement does not get it', () => {
    const tasks = deriveRoutineTasks({ legalName: 'EOY Co', engagementType: 'consulting' } as WizardAnswers)
    expect(tasks.find((t) => t.key === 'eoy-tax-checklist')).toBeUndefined()
  })
})

// ── J13 daily branch ──

describe('J13: daily_x22_shows_monthly_math', () => {
  it('a custom daily line shows the monthly math', () => {
    const quote: Quote = {
      billingCycle: 1,
      lines: [
        {
          service_key: 'custom_item_1',
          product_name: 'Daily sweep',
          unit_price: 10,
          quantity: 22,
          amount: 220,
          bucket: 'monthly',
          unpriced: false,
        },
      ],
      totals: {
        totalMonthly: 220,
        totalQuarterly: 0,
        annualExcludingFebruaryBilled: 0,
        totalPayrollMonthly: 0,
        totalFebruaryBilledAnnual: 0,
        totalOneTime: 0,
        effectiveMonthly: 220,
      },
    }
    const estimate = buildBucketedEstimate(quote, {
      engagementType: 'bookkeeping',
      customItems: [{ productName: 'Daily sweep', unitPrice: 10, frequency: 'daily' }],
    } as never)
    const line = estimate.groups.flatMap((g) => g.lines).find((l) => l.name === 'Daily sweep')
    expect(line?.math).toBe('$10/day × 22 days = $220/mo')
    expect(line?.perMonth).toBe(220)
  })
})

// ── E1 drill ──

describe('E1: the scheduling calendar drills into a day (09_30 00:50:15)', () => {
  it('clicking a plotted day lists its tasks; clicking again closes', () => {
    const tasks = deriveRoutineTasks({ legalName: 'Cal Co', engagementType: 'bookkeeping' } as WizardAnswers)
    const entries = resolveRoutineEntries(tasks, undefined)
    render(<RoutineCalendar tasks={tasks} entries={entries} />)

    // The monthly reporting card lands on a numbered day; find a plotted day button.
    const plotted = document.querySelector('[data-testid^="cal-day-"][aria-pressed]') as HTMLButtonElement | null
    expect(plotted).toBeTruthy()
    fireEvent.click(plotted!)
    const detail = screen.getByTestId('cal-day-detail')
    expect(detail).toBeInTheDocument()
    expect(detail.querySelectorAll('[data-testid="cal-day-task"]').length).toBeGreaterThan(0)

    fireEvent.click(plotted!)
    expect(screen.queryByTestId('cal-day-detail')).toBeNull()
  })

  it('empty days are inert text, not buttons', () => {
    render(<RoutineCalendar tasks={[]} entries={{}} />)
    expect(document.querySelector('[data-testid^="cal-day-"][aria-pressed]')).toBeNull()
    expect(screen.queryByTestId('cal-day-detail')).toBeNull()
  })
})

// ── D8 ──

const getEmailTemplatesAdminAction = vi.fn()
const setEmailTemplateOverrideAction = vi.fn()
vi.mock('@/server/actions/email-templates', () => ({
  getEmailTemplatesAdminAction: (...args: unknown[]) => getEmailTemplatesAdminAction(...args),
  setEmailTemplateOverrideAction: (...args: unknown[]) => setEmailTemplateOverrideAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('D8: the proposal-email template action rides the review top-right (09_30 01:07:50)', () => {
  it('opens the quote_ready editor and saves through the override action', async () => {
    getEmailTemplatesAdminAction.mockResolvedValue({
      ok: true,
      data: {
        defs: [{ key: 'quote_ready', label: 'Proposal ready' }],
        overrides: { quote_ready: { subject: 'Your bookkeeping quote', footnote: null } },
      },
    })
    setEmailTemplateOverrideAction.mockResolvedValue({ ok: true, data: { done: true } })

    render(<QuoteTemplateButton />)
    fireEvent.click(screen.getByTestId('quote-template-open'))
    const subject = await screen.findByTestId('quote-template-subject')
    expect(subject).toHaveValue('Your bookkeeping quote')

    fireEvent.change(screen.getByTestId('quote-template-footnote'), { target: { value: 'Reply with questions anytime.' } })
    fireEvent.click(screen.getByTestId('quote-template-save'))
    await waitFor(() =>
      expect(setEmailTemplateOverrideAction).toHaveBeenCalledWith('quote_ready', {
        subject: 'Your bookkeeping quote',
        footnote: 'Reply with questions anytime.',
      }),
    )
  })

  it('non-admins get the Admin → Settings pointer instead of the editor', async () => {
    getEmailTemplatesAdminAction.mockResolvedValue({ ok: false, error: 'Owner or admin access required.' })
    render(<QuoteTemplateButton />)
    fireEvent.click(screen.getByTestId('quote-template-open'))
    expect(await screen.findByTestId('quote-template-admin-link')).toBeInTheDocument()
    expect(screen.queryByTestId('quote-template-subject')).toBeNull()
  })
})

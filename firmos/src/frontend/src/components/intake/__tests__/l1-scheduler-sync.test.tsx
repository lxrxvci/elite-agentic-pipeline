import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'

import { findQuestion, removeRoutineTaskSync, type WizardAnswers } from '../registry'
import { RoutineSchedulerScreen } from '../routine-scheduler'

/**
 * L1 (H2/H3, 10_06 00:42:51 + 00:41:21): the "What are we taking on" tab and
 * the routine order & frequency tab are connected - X'ing a scheduler card
 * confirms first (H4), then writes the removal BACK to the answers so the
 * services screen un-ticks and the estimate reprices.
 */

const q = findQuestion('recurring', 'routine-scheduler')!

const BASE: WizardAnswers = {
  legalName: 'Sync Co',
  engagementType: 'bookkeeping',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  recordBills: true,
  payBills: true,
  billPayLocations: ['Chase bill pay'],
  customRecurringRules: [{ title: 'Walk my dog', scheduleType: 'monthly', isBillable: true, unitPrice: 150, subtasks: [] }],
} as unknown as WizardAnswers

function Harness({ initial }: { initial: WizardAnswers }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <RoutineSchedulerScreen q={q} answers={answers} onApply={(p) => setAnswers((a) => ({ ...a, ...p }))} onAdvance={() => {}} />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('L1/H2: scheduler_x_unticks_the_service (10_06 00:42:51)', () => {
  it('X on record-bills confirms, then clears recordBills AND payBills with locations', () => {
    render(<Harness initial={BASE} />)
    expect(screen.getByTestId('routine-card-record-bills')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('remove-record-bills'))
    // H3/H4: nothing removes until the dialog's Remove is clicked.
    const dialog = screen.getByTestId('confirm-delete-dialog')
    expect(dialog.textContent).toContain('Record bills')
    expect(answersNow().recordBills).toBe(true)

    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    const a = answersNow()
    expect(a.recordBills).toBe(false)
    expect(a.payBills).toBe(false)
    expect(a.billPayLocations).toEqual([])
    expect(screen.queryByTestId('routine-card-record-bills')).toBeNull()
    expect(screen.queryByTestId('routine-card-pay-bills')).toBeNull()
  })

  it('cancel keeps the card and the answer', () => {
    render(<Harness initial={BASE} />)
    fireEvent.click(screen.getByTestId('remove-record-bills'))
    fireEvent.click(screen.getByTestId('confirm-delete-cancel'))
    expect(screen.getByTestId('routine-card-record-bills')).toBeInTheDocument()
    expect(answersNow().recordBills).toBe(true)
  })

  it('X on a custom rule removes it from customRecurringRules (add-ons tab follows)', () => {
    render(<Harness initial={BASE} />)
    expect(screen.getByTestId('routine-card-custom:Walk my dog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('remove-custom:Walk my dog'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    expect(answersNow().customRecurringRules).toEqual([])
    expect(screen.queryByTestId('routine-card-custom:Walk my dog')).toBeNull()
  })

  it('X on a standard routine persists an exclusion (never re-derives)', () => {
    render(<Harness initial={BASE} />)
    fireEvent.click(screen.getByTestId('remove-reconcile_accounts'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    expect(answersNow().excludedDefaultRules).toContain('reconcile_accounts')
    expect(screen.queryByTestId('routine-card-reconcile_accounts')).toBeNull()
  })

  it('every card is X-able now (the EOY checklist included)', () => {
    render(<Harness initial={BASE} />)
    expect(screen.getByTestId('remove-eoy-tax-checklist')).toBeInTheDocument()
  })

  it('L1/H6: the board scrolls inside its own bounded container (drag auto-scroll works)', () => {
    render(<Harness initial={BASE} />)
    const scroll = screen.getByTestId('routine-bucket-scroll')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.className).toContain('max-h-')
  })
})

describe('L1/H2: removeRoutineTaskSync unit map', () => {
  it('merchant reconciliation clears its flag; 1099 management drops its keys', () => {
    const a = {
      includeMerchantReconciliation: true,
      include1099FullManagement: true,
      serviceKeys: ['1099_full_management', '1099_per_filing', 'invoicing'],
    } as unknown as WizardAnswers
    expect(removeRoutineTaskSync('merchant-reconciliation', a)).toEqual({ includeMerchantReconciliation: false })
    expect(removeRoutineTaskSync('1099-management', a)).toEqual({
      include1099FullManagement: false,
      serviceKeys: ['invoicing'],
    })
  })

  it('payroll clears the voluntary paths (entity-required payroll still derives by law)', () => {
    const a = {
      hasPayroll: true,
      payrollSelfProcessed: true,
      serviceKeys: ['payroll_quarterly_filings', 'process_payroll', 'invoicing'],
    } as unknown as WizardAnswers
    expect(removeRoutineTaskSync('payroll-handling', a)).toEqual({
      hasPayroll: false,
      payrollSelfProcessed: false,
      serviceKeys: ['invoicing'],
    })
  })
})

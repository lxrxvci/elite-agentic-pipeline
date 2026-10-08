import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, qualifyingFactorFor, type WizardAnswers } from '../registry'
import { ServicesScreen } from '../screens'

/**
 * L4 (G6, 10_06 00:33:23-00:34:12): every services row shows the REAL
 * qualifying factor ("Payroll: Yes · Gusto · Every two weeks") with a
 * click-through to the hero card that qualified it.
 */

describe('L4/G6: qualifyingFactorFor', () => {
  it('builds the reason strings from the answers', () => {
    const a = {
      engagementType: 'bookkeeping',
      hasPayroll: true,
      payrollProvider: 'Gusto',
      payrollFrequency: 'biweekly',
      recordBills: true,
      recordDeposits: true,
      include1099Collection: true,
      estimated1099Count: 12,
      includeMerchantReconciliation: true,
      merchantAccounts: [{ name: 'Square', processor: 'Square', processorId: 1 }],
      reportDefinitions: [{ name: 'Oregon Special Report', frequency: 'annual' }],
    } as unknown as WizardAnswers

    expect(qualifyingFactorFor('bank_feed_management', a)).toEqual({
      reason: 'Monthly bookkeeping engagement',
      chapterId: 'engagement',
      questionId: 'engagement',
    })
    expect(qualifyingFactorFor('payroll', a)).toEqual({
      reason: 'Payroll: Yes · Gusto · Every two weeks',
      chapterId: 'income',
      questionId: 'payroll-services',
    })
    expect(qualifyingFactorFor('record_bills', a)).toEqual({
      reason: 'Record bills: Yes',
      chapterId: 'reporting',
      questionId: 'record-bills',
    })
    expect(qualifyingFactorFor('record_deposits', a)).toEqual({
      reason: 'Record deposits: Yes',
      chapterId: 'income',
      questionId: 'record-deposits',
    })
    expect(qualifyingFactorFor('1099_collection', a)).toEqual({
      reason: '1099 work: collection · ~12 filings',
      chapterId: 'reporting',
      questionId: 'ten99-services',
    })
    expect(qualifyingFactorFor('merchant_account_reconciliation', a)).toEqual({
      reason: 'Processors: Square',
      chapterId: 'income',
      questionId: 'merchants',
    })
    expect(qualifyingFactorFor('specialty_reports', a)).toEqual({
      reason: '1 special report to track',
      chapterId: 'reporting',
      questionId: 'reports',
    })
  })
})

describe('L4/G6: qualified_row_shows_reason_and_links_back', () => {
  const servicesQ = findQuestion('services', 'services')!
  const ANSWERS: WizardAnswers = {
    engagementType: 'bookkeeping',
    hasPayroll: true,
    payrollProvider: 'Gusto',
    payrollFrequency: 'weekly',
    payrollSelfProcessed: true,
    serviceKeys: ['bank_feed_management', 'account_reconciliations', 'monthly_reporting_10'],
  } as unknown as WizardAnswers

  function Harness({ onJumpTo }: { onJumpTo: (c: string, q: string) => void }) {
    const [answers] = useState<WizardAnswers>(ANSWERS)
    return (
      <ServicesScreen
        q={servicesQ}
        values={answers.serviceKeys as string[]}
        answers={answers}
        onCommit={() => {}}
        onAdvance={() => {}}
        onJumpTo={onJumpTo}
      />
    )
  }

  it('a standard row carries its factor link; a qualified later-addon carries its reason link', () => {
    const onJumpTo = vi.fn()
    render(<Harness onJumpTo={onJumpTo} />)

    // Standard: "Monthly bookkeeping engagement" linking to the engagement card.
    const stdFactor = screen.getByTestId('factor-bank_feed_management')
    expect(stdFactor.textContent).toContain('Monthly bookkeeping engagement')
    fireEvent.click(stdFactor)
    expect(onJumpTo).toHaveBeenCalledWith('engagement', 'engagement')

    // Later addon (payroll, qualified): "Payroll: Yes · Gusto · Weekly".
    const payrollFactor = screen.getByTestId('factor-payroll')
    expect(payrollFactor.textContent).toContain('Payroll: Yes · Gusto · Weekly')
    fireEvent.click(payrollFactor)
    expect(onJumpTo).toHaveBeenCalledWith('income', 'payroll-services')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { qualifierFor, RoutineSchedulerScreen } from '../routine-scheduler'

/**
 * L2 (H5, 10_06 00:43:56-00:44:37): "it should just drop down… it should be
 * the same hero card that qualified record bills." Every scheduled task's
 * title opens a drop-down naming its qualifying hero card with a jump to it.
 */

const q = findQuestion('recurring', 'routine-scheduler')!
const BASE: WizardAnswers = {
  legalName: 'Link Co',
  engagementType: 'bookkeeping',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  recordBills: true,
} as unknown as WizardAnswers

function Harness({ onJumpTo }: { onJumpTo: (c: string, qid: string) => void }) {
  const [answers] = useState<WizardAnswers>(BASE)
  return <RoutineSchedulerScreen q={q} answers={answers} onApply={() => {}} onAdvance={() => {}} onJumpTo={onJumpTo} />
}

describe('L2/H5: task_click_drops_qualifying_card (10_06 00:43:56)', () => {
  it('the qualifier map: derived cards point at their hero card; standards + customs resolve', () => {
    expect(qualifierFor('record-bills')).toEqual({ chapterId: 'reporting', questionId: 'record-bills' })
    expect(qualifierFor('record-deposits')).toEqual({ chapterId: 'income', questionId: 'record-deposits' })
    expect(qualifierFor('payroll-handling')).toEqual({ chapterId: 'income', questionId: 'payroll-services' })
    expect(qualifierFor('reconcile_accounts')).toBe('standard')
    expect(qualifierFor('eoy-tax-checklist')).toBe('standard')
    expect(qualifierFor('specialty:Oregon Special Report')).toEqual({ chapterId: 'reporting', questionId: 'reports' })
    expect(qualifierFor('custom:Walk my dog')).toEqual({ chapterId: 'services', questionId: 'services' })
  })

  it('clicking a task title drops the qualifying hero card with a jump button', () => {
    const onJumpTo = vi.fn()
    render(<Harness onJumpTo={onJumpTo} />)
    expect(screen.getByTestId('routine-card-record-bills')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('qualifier-toggle-record-bills'))
    const drop = screen.getByTestId('qualifier-record-bills')
    expect(drop.textContent).toContain('Should we record their bills?')

    fireEvent.click(screen.getByTestId('qualifier-jump-record-bills'))
    expect(onJumpTo).toHaveBeenCalledWith('reporting', 'record-bills')

    // Toggle closes.
    fireEvent.click(screen.getByTestId('qualifier-toggle-record-bills'))
    expect(screen.queryByTestId('qualifier-record-bills')).toBeNull()
  })

  it('a standard routine explains itself instead of jumping', () => {
    render(<Harness onJumpTo={() => {}} />)
    fireEvent.click(screen.getByTestId('qualifier-toggle-reconcile_accounts'))
    const drop = screen.getByTestId('qualifier-reconcile_accounts')
    expect(drop.textContent).toContain('Included in every bookkeeping engagement')
    expect(screen.queryByTestId('qualifier-jump-reconcile_accounts')).toBeNull()
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * L1 (H1, 10_06 00:37:30-00:39:47): "Walk My Dog is showing up on the
 * scheduler, not on the add-ons tab." Custom recurring work lists in the
 * services add-ons section (cadence + price), deletes confirm first (H4),
 * and billable rules price into the estimate.
 */

function ServicesHarness({ initial }: { initial: WizardAnswers }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  const q = findQuestion('services', 'services')! as QuestionDef
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const WITH_CUSTOMS: WizardAnswers = {
  engagementType: 'bookkeeping',
  customRecurringRules: [
    { title: 'Walk my dog', scheduleType: 'monthly', isBillable: true, unitPrice: 150, subtasks: [] },
  ],
  customItems: [{ productName: 'Cleanup day', unitPrice: 400, frequency: 'one_time' }],
} as unknown as WizardAnswers

describe('L1/H1: recurring_custom_appears_in_addons (10_06 00:37:30)', () => {
  it('custom work lists in the add-ons section with cadence and price', () => {
    render(<ServicesHarness initial={WITH_CUSTOMS} />)
    const list = screen.getByTestId('custom-addon-list')
    expect(list.textContent).toContain('Walk my dog')
    expect(list.textContent).toContain('Monthly')
    expect(list.textContent).toContain('$150')
    expect(list.textContent).toContain('Cleanup day')
    expect(list.textContent).toContain('One-time')
    expect(list.textContent).toContain('$400')
  })

  it('delete_never_fires_without_confirm: the X opens the dialog and only Delete removes', () => {
    render(<ServicesHarness initial={WITH_CUSTOMS} />)
    fireEvent.click(screen.getByTestId('custom-addon-delete-Walk my dog'))
    const dialog = screen.getByTestId('confirm-delete-dialog')
    expect(dialog.textContent).toContain('Walk my dog')
    expect(dialog.textContent).toContain('routine schedule')

    // Keep it: nothing removed.
    fireEvent.click(screen.getByTestId('confirm-delete-cancel'))
    expect(screen.getByTestId('custom-addon-list').textContent).toContain('Walk my dog')

    // Delete: the rule leaves the answers (scheduler + estimate follow).
    fireEvent.click(screen.getByTestId('custom-addon-delete-Walk my dog'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    const answers = JSON.parse(screen.getByTestId('answers').textContent ?? '{}')
    expect(answers.customRecurringRules).toEqual([])
    expect(answers.customItems).toHaveLength(1)
  })
})

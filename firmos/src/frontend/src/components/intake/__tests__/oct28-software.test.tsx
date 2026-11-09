import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

function Harness({ onAdvance }: { onAdvance: () => void }) {
  const q = findQuestion('software', 'qbo-status')!
  const [answers, setAnswers] = useState<WizardAnswers>({ engagementType: 'bookkeeping' })
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={onAdvance}
        onPickOption={(value) => setAnswers((current) => ({ ...current, ...q.apply(current, value) }))}
        optionLists={{}}
        onAddOptionListValue={vi.fn(async (_listKey: string, name: string) => ({
          id: 42,
          listKey: 'accounting_software',
          name,
          meta: null,
          isActive: true,
        }))}
      />
      <output data-testid="software-answer">{String(answers.quickbooksStatus ?? '')}</output>
    </>
  )
}

describe('October 28 custom accounting software', () => {
  it('adding Other persists and selects the new software immediately', async () => {
    const onAdvance = vi.fn()
    render(<Harness onAdvance={onAdvance} />)
    fireEvent.click(screen.getByTestId('option-Other'))
    fireEvent.change(screen.getByTestId('custom-input-qbo-status'), { target: { value: 'Google bookkeeping' } })
    fireEvent.click(screen.getByTestId('continue'))

    await waitFor(() => expect(onAdvance).toHaveBeenCalled())
    expect(screen.getByTestId('software-answer')).toHaveTextContent('Google bookkeeping')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * L1 (E1, 10_06 00:24:06-00:25:07): "it should just be a number we can type
 * in." The 1099 estimated-count is a free numeric text input, not a dropdown.
 */

function Harness({ initial }: { initial: WizardAnswers }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  const q = findQuestion('reporting', 'ten99-services')!
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

describe('L1/E1: 1099_count_accepts_typed_56 (10_06 00:24:06)', () => {
  it('keeps the optional estimate inline on the qualifying 1099 choice', () => {
    render(<Harness initial={{ serviceKeys: ['1099_collection'] } as unknown as WizardAnswers} />)
    expect(screen.getByTestId('inline-followup-1099-estimate')).toBeInTheDocument()
    expect(screen.queryByTestId('followup-select-estimated1099Count')).toBeNull()

    const input = screen.getByLabelText('Estimated filings (optional)')
    fireEvent.change(input, { target: { value: '56' } })
    expect(JSON.parse(screen.getByTestId('answers').textContent ?? '{}').estimated1099Count).toBe(56)

    fireEvent.change(input, { target: { value: 'abc' } })
    expect(JSON.parse(screen.getByTestId('answers').textContent ?? '{}').estimated1099Count).toBeNull()

    fireEvent.change(input, { target: { value: '1234' } })
    expect(JSON.parse(screen.getByTestId('answers').textContent ?? '{}').estimated1099Count).toBe(1234)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByRole('alert')).toHaveTextContent('Estimated filings should be 999 or less.')
  })
})

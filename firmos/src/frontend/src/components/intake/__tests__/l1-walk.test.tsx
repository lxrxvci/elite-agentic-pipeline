import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'

import { EditQuestionDialog, type EditTarget } from '../edit-overlay'
import { findChapter, visibleQuestions, type WizardAnswers } from '../registry'

/**
 * L1 (G1, 10_06 01:03:07): the section-header Edit must walk EVERY question
 * in the chapter ("it should walk you through all those options… in case
 * you wanted to fly through and re-edit them real quick"); a row pencil
 * edits its single question.
 */

function Harness({ target }: { target: EditTarget }) {
  const [answers, setAnswers] = useState<WizardAnswers>({})
  const [closed, setClosed] = useState(false)
  if (closed) return <pre data-testid="closed">closed</pre>
  return (
    <div>
      <EditQuestionDialog
        target={target}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onClose={() => setClosed(true)}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const contact = findChapter('contact')!
const walkable = visibleQuestions(contact, {})

describe('L1/G1: parent_edit_walks_every_chapter_question (10_06 01:03:07)', () => {
  it('walk mode steps through the chapter in sequence and closes on the last', () => {
    expect(walkable.length).toBeGreaterThanOrEqual(3)
    render(<Harness target={{ chapterId: 'contact', questionId: walkable[0].id, walk: true }} />)

    // Question 1 of N: fill required fields, Continue advances without closing.
    expect(screen.getByTestId('edit-walk-progress').textContent).toBe(`1 of ${walkable.length}`)
    expect(screen.getByTestId('edit-overlay').getAttribute('data-question')).toBe(walkable[0].id)
    expect(screen.getByTestId('edit-walk-back')).toBeDisabled()

    const fillRequired = () => {
      const dialog = screen.getByTestId('edit-overlay')
      const inputs = dialog.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
      inputs.forEach((el) => {
        const input = el as HTMLInputElement
        if (input.value !== '' || input.readOnly || input.disabled) return
        const value = input.type === 'email' ? 'wren@x.io' : input.type === 'tel' ? '5035550182' : 'Wren Okafor'
        fireEvent.change(input, { target: { value } })
      })
    }
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(screen.queryByTestId('closed')).toBeNull()
    expect(screen.getByTestId('edit-walk-progress').textContent).toBe(`2 of ${walkable.length}`)
    expect(screen.getByTestId('edit-overlay').getAttribute('data-question')).toBe(walkable[1].id)

    // Back returns to the first question without closing.
    fireEvent.click(screen.getByTestId('edit-walk-back'))
    expect(screen.getByTestId('edit-overlay').getAttribute('data-question')).toBe(walkable[0].id)
    expect(screen.queryByTestId('closed')).toBeNull()

    const advanceBtn = () =>
      screen.queryByRole('button', { name: /^continue$/i }) ?? screen.queryByRole('button', { name: /skip for now/i })

    // Forward to the final question; its Continue/Skip/pick closes the dialog.
    for (let i = 1; i < walkable.length; i++) {
      fillRequired()
      const btn = advanceBtn()
      if (btn) fireEvent.click(btn)
    }
    expect(screen.getByTestId('edit-overlay').getAttribute('data-question')).toBe(walkable[walkable.length - 1].id)
    const noPick = screen.queryByRole('option', { name: /^no$/i }) ?? screen.queryByRole('button', { name: /^no$/i })
    if (noPick) fireEvent.click(noPick)
    else fireEvent.click(advanceBtn()!)
    expect(screen.getByTestId('closed')).toBeInTheDocument()
  })

  it('single-question mode (row pencil) still closes on pick - no stepper chrome', () => {
    render(<Harness target={{ chapterId: 'engagement', questionId: 'engagement' }} />)
    expect(screen.queryByTestId('edit-walk-nav')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /consulting/i }))
    expect(screen.getByTestId('closed')).toBeInTheDocument()
  })
})

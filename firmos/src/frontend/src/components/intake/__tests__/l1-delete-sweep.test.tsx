import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'

import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * L1 (H4, 10_06 00:31:41-00:32:23): "anything that's deleting data, there
 * should be a warning to delete anywhere in the system." The committed-card
 * X (repeatables) and the account mini-form X confirm before removing.
 */

function Harness({ q, initial }: { q: QuestionDef; initial: WizardAnswers }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
        institutions={[]}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('L1/H4: delete_never_fires_without_confirm (10_06 00:31:41)', () => {
  it('committed owner card: X opens the dialog; only Remove deletes', () => {
    const ownersQ = findQuestion('entity', 'owners')!
    render(
      <Harness
        q={ownersQ}
        initial={{
          taxStructure: 'S Corporation',
          owners: [
            { name: 'Matt Becker', ownershipPercent: 60 },
            { name: 'Jason Yecny', ownershipPercent: 40 },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('entity-remove-0'))
    const dialog = screen.getByTestId('confirm-delete-dialog')
    expect(dialog.textContent).toContain('Matt Becker')
    expect(answersNow().owners).toHaveLength(2)

    fireEvent.click(screen.getByTestId('confirm-delete-cancel'))
    expect(answersNow().owners).toHaveLength(2)

    fireEvent.click(screen.getByTestId('entity-remove-0'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    expect(answersNow().owners).toEqual([{ name: 'Jason Yecny', ownershipPercent: 40 }])
  })

  it('account mini-form: X opens the dialog; only Remove deletes', () => {
    const checkingQ = findQuestion('balance', 'checking-accounts')!
    render(
      <Harness
        q={checkingQ}
        initial={{
          checkingAccounts: [
            { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
          ],
        } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('remove-account-0'))
    const dialog = screen.getByTestId('confirm-delete-dialog')
    expect(dialog.textContent).toContain('4411')
    expect(answersNow().checkingAccounts).toHaveLength(1)

    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
    expect(answersNow().checkingAccounts).toEqual([])
  })
})

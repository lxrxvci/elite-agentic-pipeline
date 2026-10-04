import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type OptionListValueLite, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * K8 (B4, 09_30 00:06:12): "should I be able to put that in?… we create
 * role types… the role type should be a database of options. So once you
 * create one option, it's there for all other intakes." The contacts Role
 * field type-aheads the contact_roles list and a new role persists globally
 * on commit. Legacy enum values ('primary_contact'/'related'/'cpa') keep
 * rendering and converting.
 */

function Harness({
  q,
  initial,
  optionLists,
  onAddOptionListValue,
}: {
  q: QuestionDef
  initial: WizardAnswers
  optionLists?: Record<string, OptionListValueLite[]>
  onAddOptionListValue?: (listKey: string, name: string) => Promise<OptionListValueLite | null>
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={(v) => setAnswers((a) => ({ ...a, ...q.apply(a, v) }))}
        optionLists={optionLists}
        onAddOptionListValue={onAddOptionListValue}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

const contactsQ = findQuestion('entity', 'contacts')!

describe('B4: role types are a database (09_30 00:06:12)', () => {
  it('the Role field type-aheads the contact_roles list (no hardcoded 2-option select)', () => {
    render(
      <Harness
        q={contactsQ}
        initial={{}}
        optionLists={{ contact_roles: [{ id: 1, name: 'Office manager' }] }}
      />,
    )
    const roleInput = screen.getByLabelText('Role')
    expect(roleInput.tagName).toBe('INPUT')
    const datalist = screen.getByTestId('datalist-relationshipType')
    expect(datalist.querySelector('option[value="Office manager"]')).not.toBeNull()
  })

  it('custom_role_persists_globally: a new role persists to contact_roles on commit', async () => {
    const onAddOptionListValue = vi.fn(async (_listKey: string, name: string) => ({ id: 9, name }))
    render(
      <Harness
        q={contactsQ}
        initial={{}}
        optionLists={{ contact_roles: [{ id: 1, name: 'Office manager' }] }}
        onAddOptionListValue={onAddOptionListValue}
      />,
    )
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Wren' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Billing contact' } })
    fireEvent.click(screen.getByRole('button', { name: /add contact/i }))
    await waitFor(() => expect(onAddOptionListValue).toHaveBeenCalledWith('contact_roles', 'Billing contact'))
    expect(answersNow().contacts?.[0]?.relationshipType).toBe('Billing contact')
  })

  it('committed cards show the role label - custom and legacy alike', () => {
    render(
      <Harness
        q={contactsQ}
        initial={{
          contacts: [
            { firstName: 'Wren', relationshipType: 'Office manager' },
            { firstName: 'Sal', relationshipType: 'primary_contact' },
            { firstName: 'Yes', entityName: 'Yes Taxes LLC', relationshipType: 'cpa' },
          ],
        }}
      />,
    )
    const text = document.body.textContent ?? ''
    expect(text).toContain('Office manager')
    expect(text).toContain('Primary contact')
    expect(text).toContain('CPA')
  })
})

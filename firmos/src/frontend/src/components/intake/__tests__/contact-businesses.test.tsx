import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

function MainContact({ contactId }: { contactId?: number }) {
  const [answers, setAnswers] = useState<WizardAnswers>({
    legalName: 'Harborline Marine Supply',
    mainContactId: contactId ?? null,
    contacts: [{
      contactId: contactId ?? null,
      isPrimary: true,
      firstName: 'Wren',
      lastName: 'Okafor',
      email: 'wren@example.com',
      emailChannels: contactId ? [{ value: 'billing@example.com', businesses: [{ id: 1, name: 'Harborline Marine Supply' }] }] : [],
    }],
  })
  const q = findQuestion('contact', 'main-contact')!
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
        contactSearch={async (_query, associationContactId) => ({
          contacts: [],
          clients: associationContactId === contactId && contactId != null
            ? [{ kind: 'client', id: 2, name: 'Blue Spruce Landscaping' }]
            : [],
        })}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

describe('contact business associations', () => {
  it('offers no businesses for a new contact and explains where to add one', async () => {
    render(<MainContact />)
    const add = screen.getByTestId('channel-email-add')
    fireEvent.click(add)
    const picker = screen.getByRole('combobox', { name: 'Associated businesses for Other emails (optional) 1' })
    fireEvent.click(picker)
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Harborline Marine Supply' })).not.toBeInTheDocument())
    expect(screen.queryByRole('option', { name: 'Blue Spruce Landscaping' })).not.toBeInTheDocument()
    expect(screen.getByText('Add the business through its client record, then resume this intake to associate it.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /add business/i })).not.toBeInTheDocument()
  })

  it('adds only businesses associated with the selected contact', async () => {
    render(<MainContact contactId={17} />)
    const picker = screen.getByRole('combobox', { name: 'Associated businesses for Other emails (optional) 1' })
    expect(await screen.findByTestId('channel-email-business-picker-0-selected-id:1')).toHaveTextContent('Harborline Marine Supply')
    fireEvent.click(picker)
    fireEvent.click(await screen.findByRole('option', { name: 'Blue Spruce Landscaping' }))
    expect(screen.queryByRole('option', { name: 'Unassociated Business' })).not.toBeInTheDocument()
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers.contacts).toHaveLength(1)
    expect(answers.contacts![0]!.emailChannels![0]!.businesses).toEqual([
      { id: 1, name: 'Harborline Marine Supply' },
      { id: 2, name: 'Blue Spruce Landscaping' },
    ])
  })

  it('keeps the canonical link when editing the selected contact', () => {
    render(<MainContact contactId={17} />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Wren Edited' } })
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers.contacts![0]).toMatchObject({ contactId: 17, firstName: 'Wren', lastName: 'Edited' })
    expect(answers.mainContactId).toBe(17)
    expect(screen.getByLabelText('Email').parentElement?.className).toContain('sm:col-span-2')
    expect(screen.getByLabelText('Phone').parentElement?.className).toContain('sm:col-span-2')
  })
})

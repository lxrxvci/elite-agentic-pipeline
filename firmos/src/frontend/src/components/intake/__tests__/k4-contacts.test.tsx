import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, syncLinkedContactCopies, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * K4 (meeting 09_30): editable committed cards, the contact type-ahead on
 * every person field, cross-card sync, and the processor tile grid.
 */

function Harness({
  q,
  initial,
  onAdvance,
  contactSearch,
}: {
  q: QuestionDef
  initial: WizardAnswers
  onAdvance?: () => void
  contactSearch?: (query: string) => Promise<never>
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={(v) => setAnswers((a) => ({ ...a, ...q.apply(a, v) }))}
        contactSearch={contactSearch}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('J6: every_committed_item_editable (09_30 00:01:54)', () => {
  const ownersQ = findQuestion('entity', 'owners')!
  const base: WizardAnswers = {
    taxStructure: 'S Corporation',
    owners: [{ name: 'Wren Okafor', email: 'wren@x.io', ownershipPercent: 100 }],
  }

  it('committed_card_expands_and_edits_inline - click, change, save', () => {
    render(<Harness q={ownersQ} initial={base} />)
    // Vertical stacked cards (a list), not side-by-side chips.
    const card = screen.getByTestId('entity-chip')
    expect(card.closest('ul')!.className).not.toContain('flex-wrap')

    fireEvent.click(screen.getByTestId('entity-edit-0'))
    const form = screen.getByTestId('entity-edit-form-0')
    expect(form).toBeInTheDocument()
    expect(within(form).getByLabelText('Email (optional)')).toHaveValue('wren@x.io')

    fireEvent.change(within(form).getByLabelText('Email (optional)'), { target: { value: 'wren.okafor@x.io' } })
    fireEvent.click(screen.getByTestId('entity-edit-save-0'))
    expect(answersNow().owners?.[0]?.email).toBe('wren.okafor@x.io')
    // The card collapses back to its summary.
    expect(screen.queryByTestId('entity-edit-form-0')).toBeNull()
  })

  it('cancel discards the in-progress edit', () => {
    render(<Harness q={ownersQ} initial={base} />)
    fireEvent.click(screen.getByTestId('entity-edit-0'))
    fireEvent.change(within(screen.getByTestId('entity-edit-form-0')).getByLabelText('Email (optional)'), { target: { value: 'changed@x.io' } })
    fireEvent.click(screen.getByTestId('entity-edit-cancel-0'))
    expect(answersNow().owners?.[0]?.email).toBe('wren@x.io')
  })
})

describe('B6: contact_picker_on_every_person_field (09_30 00:07:51)', () => {
  const hit = {
    kind: 'contact' as const,
    id: 42,
    name: 'Sal Vega',
    firstName: 'Sal',
    lastName: 'Vega',
    entityName: null,
    email: 'sal@vega.io',
    phone: '5035550182',
  }
  const search = vi.fn(async () => ({ contacts: [hit], clients: [] }))

  it('the owners screen offers the type-ahead and a pick links the person (owner role)', async () => {
    const ownersQ = findQuestion('entity', 'owners')!
    render(<Harness q={ownersQ} initial={{ taxStructure: 'S Corporation' }} contactSearch={search as never} />)

    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'sal' } })
    fireEvent.click(await screen.findByText('Sal Vega'))

    const owners = answersNow().owners ?? []
    expect(owners).toHaveLength(1)
    expect(owners[0]).toMatchObject({ contactId: 42, name: 'Sal Vega', email: 'sal@vega.io' })
  })

  it('the main-contact card offers the type-ahead and prefills name/email/phone', async () => {
    const mainContact = findQuestion('contact', 'main-contact')!
    render(<Harness q={mainContact} initial={{}} contactSearch={search as never} />)

    fireEvent.change(screen.getByTestId('contact-picker-input'), { target: { value: 'sal' } })
    fireEvent.click(await screen.findByText('Sal Vega'))

    expect(screen.getByLabelText('Full name')).toHaveValue('Sal Vega')
    expect(screen.getByLabelText('Email')).toHaveValue('sal@vega.io')
    expect(screen.getByLabelText('Phone')).toHaveValue('(503) 555-0182')
    // The link rides into the primary contact entry on commit.
    fireEvent.click(screen.getByTestId('continue'))
    const primary = (answersNow().contacts ?? []).find((c) => c.isPrimary)
    expect(primary?.contactId).toBe(42)
  })
})

describe('B7: edit_syncs_across_cards (09_30 00:06:59)', () => {
  it('a linked owner copy follows the primary contact edit', () => {
    const before: WizardAnswers = {
      contacts: [
        { contactId: 42, firstName: 'Sal', lastName: 'Vega', email: 'sal@vega.io', phone: '5035550182', isPrimary: true, relationshipType: 'primary_contact' },
      ],
      owners: [{ contactId: 42, name: 'Sal Vega', email: 'sal@vega.io', phone: '5035550182' }],
    }
    // Edit the primary's email in the store...
    const after: WizardAnswers = {
      ...before,
      contacts: [{ ...before.contacts![0], email: 'salvador@vega.io' }],
    }
    const sync = syncLinkedContactCopies(after)
    expect(sync?.owners?.[0]?.email).toBe('salvador@vega.io')
    expect(syncLinkedContactCopies({ ...after, owners: sync!.owners! })).toBeNull() // settles
  })
})

describe('C6/C7: processor tiles', () => {
  const merchantsQ = findQuestion('income', 'merchants')!
  const processors = [
    { id: 2, name: 'Stripe' },
    { id: 1, name: 'Square' },
  ]

  it('the comparison is settled (L2/B3): no tile grid - the alphabetized vertical stack is the UI', () => {
    function MerchantHarness() {
      const [answers, setAnswers] = useState<WizardAnswers>({ paymentMethods: ['card'] })
      return (
        <div>
          <QuestionScreen
            q={merchantsQ}
            answers={answers}
            onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
            onAdvance={() => {}}
            onPickOption={() => {}}
            merchantProcessors={processors}
          />
          <pre data-testid="answers">{JSON.stringify(answers)}</pre>
        </div>
      )
    }
    render(<MerchantHarness />)

    // L2 (B3, 10_06 00:10:01): tiles are retired - one vertical stack where
    // click selects without a name re-entry (the l2-processor-stack spec
    // covers select/deselect, pencil rename, and add).
    expect(screen.queryByTestId('processor-tiles')).toBeNull()
    expect(screen.getByTestId('processor-stack')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('processor-toggle-Square'))
    expect(answersNow().merchantAccounts).toEqual([
      expect.objectContaining({ processor: 'Square', processorId: 1, name: 'Square' }),
    ])
    fireEvent.click(screen.getByTestId('processor-toggle-Square'))
    expect(answersNow().merchantAccounts).toEqual([])
  })
})

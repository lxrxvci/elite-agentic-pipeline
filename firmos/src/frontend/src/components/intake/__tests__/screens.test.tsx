import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { dateTextDigits, dateTextLabel, dateTextToIso, isoToDateText, maskDateText } from '../date-text'
import { formatPhone, phoneDigits } from '../format'
import { findQuestion, type QuestionDef, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * I1 interaction units: the masked date-text field, phone auto-formatting,
 * the "Other - type it" card on selects, and the owner prefill buttons on
 * the contacts repeatable. Rendered against the real registry questions.
 */

function Harness({ q, initial, onAdvance }: { q: QuestionDef; initial: WizardAnswers; onAdvance?: () => void }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={onAdvance ?? (() => {})}
        onPickOption={(v) => setAnswers((a) => ({ ...a, ...q.apply(a, v) }))}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('date-text field (I1, 00:33:00)', () => {
  it('masks digits into MM/DD/YYYY while typing', () => {
    expect(maskDateText('01052026')).toBe('01/05/2026')
    expect(maskDateText('1')).toBe('1')
    expect(maskDateText('121')).toBe('12/1')
    expect(maskDateText('12/05/2026')).toBe('12/05/2026')
    expect(dateTextDigits('(12) ab-05/2026!!')).toBe('12052026')
  })

  it('parses only real dates', () => {
    expect(dateTextToIso('01/05/2026')).toBe('2026-01-05')
    expect(dateTextToIso('02/29/2024')).toBe('2024-02-29') // leap day
    expect(dateTextToIso('02/29/2026')).toBeNull() // not a leap year
    expect(dateTextToIso('13/45/2026')).toBeNull() // impossible month and day
    expect(dateTextToIso('00/10/2026')).toBeNull()
    expect(dateTextToIso('12/31/1800')).toBeNull() // out of range
    expect(dateTextToIso('01/05/26')).toBeNull() // incomplete
    expect(dateTextToIso('')).toBeNull()
  })

  it('round-trips ISO display and labels the review row', () => {
    expect(isoToDateText('2026-01-05')).toBe('01/05/2026')
    expect(isoToDateText(null)).toBe('')
    expect(dateTextLabel('2026-01-05')).toBe('Jan 5, 2026')
    expect(dateTextLabel('garbage')).toBeNull()
  })

  it('rejects 13/45/2026: nothing commits, the inline alert shows, Continue blocks', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('starting', 'bk-start')!} initial={{ engagementType: 'bookkeeping' }} onAdvance={onAdvance} />)
    const input = screen.getByLabelText('Books start date')
    fireEvent.change(input, { target: { value: '13/45/2026' } })
    expect(input).toHaveValue('13/45/2026')
    expect(screen.getByRole('alert')).toHaveTextContent("That date isn't real")
    expect(answersNow().bookkeepingStartDate ?? null).toBeNull()

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByText("That date isn't real - use MM/DD/YYYY.")).toBeInTheDocument()
    expect(screen.getByText('Books start date is required.')).toBeInTheDocument()
  })

  it('commits a valid typed date as ISO on the stable answer key', () => {
    const onAdvance = vi.fn()
    render(<Harness q={findQuestion('starting', 'bk-start')!} initial={{ engagementType: 'bookkeeping' }} onAdvance={onAdvance} />)
    const input = screen.getByLabelText('Books start date')
    fireEvent.change(input, { target: { value: '01052026' } })
    expect(input).toHaveValue('01/05/2026')
    expect(answersNow().bookkeepingStartDate).toBe('2026-01-05')

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('renders an existing ISO answer as masked text', () => {
    render(
      <Harness
        q={findQuestion('starting', 'bk-start')!}
        initial={{ engagementType: 'bookkeeping', bookkeepingStartDate: '2026-01-05' }}
      />,
    )
    expect(screen.getByLabelText('Books start date')).toHaveValue('01/05/2026')
  })
})

describe('phone auto-format (I1, 00:30:14)', () => {
  it('formats progressively and stores digits only', () => {
    expect(formatPhone('5')).toBe('(5')
    expect(formatPhone('503')).toBe('(503')
    expect(formatPhone('5035')).toBe('(503) 5')
    expect(formatPhone('5035550')).toBe('(503) 555-0')
    expect(formatPhone('5035550182')).toBe('(503) 555-0182')
    expect(formatPhone('15035550182')).toBe('+1 (503) 555-0182')
    expect(phoneDigits('(503) 555-0182')).toBe('5035550182')
    expect(phoneDigits(null)).toBe('')
  })

  it('the main-contact phone field masks while typing and commits digits', () => {
    render(<Harness q={findQuestion('contact', 'main-contact')!} initial={{ legalName: 'Test Co' }} />)
    const phone = screen.getByLabelText('Phone')
    fireEvent.change(phone, { target: { value: '5035550182' } })
    expect(phone).toHaveValue('(503) 555-0182')
    expect(answersNow().contacts?.[0]?.phone).toBe('5035550182')
  })
})

describe('"Other - type it" on carded selects (I1, 00:15:53)', () => {
  it('appends the Other card on multi-option selects and opens the inline input when picked', () => {
    render(<Harness q={findQuestion('engagement', 'engagement')!} initial={{}} />)
    const other = screen.getByTestId('option-Other')
    expect(other).toHaveTextContent('Other — type it')
    fireEvent.click(other)
    const input = screen.getByTestId('custom-input-engagement')
    fireEvent.change(input, { target: { value: 'Fractional CFO retainer' } })
    const a = answersNow()
    expect(a.engagementType).toBe('Other')
    expect(a.customAnswers).toEqual({ engagement: 'Fractional CFO retainer' })
    // A Continue button appears since auto-advance is suppressed on Other.
    expect(screen.getByTestId('continue')).toBeInTheDocument()
  })

  it('reuses the existing Other option card when the question already has one', () => {
    render(<Harness q={findQuestion('entity', 'tax-structure')!} initial={{}} />)
    expect(screen.getAllByTestId('option-Other')).toHaveLength(1)
    expect(screen.getByTestId('option-Other')).toHaveTextContent('Other / not sure')
  })

  it('never adds Other to yes/no cards', () => {
    render(<Harness q={findQuestion('entity', 'has-cpa')!} initial={{}} />)
    expect(screen.queryByTestId('option-Other')).toBeNull()
  })
})

describe('contacts owner prefill (I1, 00:29:05)', () => {
  it('fills the draft from the tapped owner', () => {
    render(
      <Harness
        q={findQuestion('entity', 'contacts')!}
        initial={{ owners: [{ name: 'Wren Okafor', email: 'wren@fernfeather.shop', phone: '5035550182' }] }}
      />,
    )
    const prefill = screen.getByTestId('prefill-0')
    expect(prefill).toHaveTextContent('Same as Wren Okafor')
    fireEvent.click(prefill)
    expect(screen.getByLabelText('First name')).toHaveValue('Wren')
    expect(screen.getByLabelText('Last name')).toHaveValue('Okafor')
    expect(screen.getByLabelText('Email')).toHaveValue('wren@fernfeather.shop')
    expect(screen.getByLabelText('Phone')).toHaveValue('(503) 555-0182')

    fireEvent.click(screen.getByTestId('add-another'))
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
  })

  it('offers no prefill buttons when there are no owners', () => {
    render(<Harness q={findQuestion('entity', 'contacts')!} initial={{}} />)
    expect(screen.queryByTestId('prefill-0')).toBeNull()
  })
})


describe('owner-count guards on the owners screen (I2, 00:26:10)', () => {
  const ownersQ = findQuestion('entity', 'owners')!

  it('sole prop: Continue with no owners blocks with the plain-language message', () => {
    const onAdvance = vi.fn()
    render(
      <Harness q={ownersQ} initial={{ taxStructure: 'Sole proprietorship' }} onAdvance={onAdvance} />,
    )
    // An unskippable minimum: the button reads Continue, not "Skip for now".
    expect(screen.getByTestId('continue')).toHaveTextContent('Continue')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('A sole proprietorship has exactly one owner.')
  })

  it('sole prop: one owner in, the add form swaps for the cap note', () => {
    const onAdvance = vi.fn()
    render(
      <Harness q={ownersQ} initial={{ taxStructure: 'Sole proprietorship' }} onAdvance={onAdvance} />,
    )
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Wren Okafor' } })
    fireEvent.click(screen.getByTestId('add-another'))
    expect(screen.getByText('Wren Okafor')).toBeInTheDocument()
    // Capped at 1: the draft form is gone, replaced by the note.
    expect(screen.getByTestId('cap-note')).toHaveTextContent('One owner is the cap for a sole proprietorship.')
    expect(screen.queryByTestId('add-another')).toBeNull()
    expect(screen.queryByLabelText('Full name')).toBeNull()

    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('single-member LLC caps at one owner the same way', () => {
    render(
      <Harness
        q={ownersQ}
        initial={{ taxStructure: 'LLC', llcSubclass: 'llc_sml', owners: [{ name: 'Wren Okafor' }] }}
      />,
    )
    expect(screen.getByTestId('cap-note')).toHaveTextContent('One owner is the cap for a single-member LLC.')
    expect(screen.queryByTestId('add-another')).toBeNull()
  })

  it('partnership_requires_two_owners: one owner blocks, two pass', () => {
    const onAdvance = vi.fn()
    render(
      <Harness
        q={ownersQ}
        initial={{ taxStructure: 'LLC', llcSubclass: 'llc_partnership', owners: [{ name: 'Wren Okafor' }] }}
        onAdvance={onAdvance}
      />,
    )
    // One listed owner, empty draft: Continue blocks with the message.
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('A partnership needs at least 2 owners.')

    // Add the second owner and Continue sails through.
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sal Vega' } })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalled()
    expect(answersNow().owners).toHaveLength(2)
  })

  it('partnership is uncapped: a third owner still fits', () => {
    render(
      <Harness
        q={ownersQ}
        initial={{
          taxStructure: 'Partnership',
          owners: [{ name: 'Wren Okafor' }, { name: 'Sal Vega' }],
        }}
      />,
    )
    expect(screen.queryByTestId('cap-note')).toBeNull()
    expect(screen.getByTestId('add-another')).toBeInTheDocument()
  })
})

describe('corporate payroll card (I2, 00:48:07)', () => {
  it('an S corp pre-selects Yes and locks the No card', () => {
    render(<Harness q={findQuestion('income', 'payroll')!} initial={{ taxStructure: 'S-corp' }} />)
    expect(screen.getByTestId('option-yes')).toHaveAttribute('data-selected', 'true')
    const no = screen.getByTestId('option-no')
    expect(no).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(no)
    // The locked card never applies: still Yes, still unanswered-stored.
    expect(answersNow().hasPayroll ?? null).toBeNull()
  })

  it('a sole prop gets the owner-never-on-payroll nuance and a live No card', () => {
    render(<Harness q={findQuestion('income', 'payroll')!} initial={{ taxStructure: 'Sole proprietorship' }} />)
    const no = screen.getByTestId('option-no')
    expect(no).not.toHaveAttribute('aria-disabled')
    fireEvent.click(no)
    expect(answersNow().hasPayroll).toBe(false)
  })
})

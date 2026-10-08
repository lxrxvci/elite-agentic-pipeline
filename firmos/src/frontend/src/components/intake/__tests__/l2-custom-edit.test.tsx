import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type OptionListValueLite, type WizardAnswers } from '../registry'
import { ServicesScreen } from '../screens'

/**
 * L2 (H7, 10_06 00:35:38-00:41:21): custom add-ons are editable (name,
 * cadence, price, industry tag); a tagged custom joins the industry
 * suggestion engine (tagged = only that industry sees it); `custom:` industry
 * suggestions add as custom rules, never service keys.
 */

const servicesQ = findQuestion('services', 'services')!
const INDUSTRIES: OptionListValueLite[] = [
  { id: 1, name: 'Construction' },
  { id: 2, name: 'Medical / therapy practice' },
]

function Harness({
  initial,
  onTagIndustry,
  industrySuggestions = [],
}: {
  initial: WizardAnswers
  onTagIndustry?: (industry: string, title: string) => void
  industrySuggestions?: { id: number; serviceKey: string; explainer: string }[]
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  return (
    <div>
      <ServicesScreen
        q={servicesQ}
        values={(answers.serviceKeys as string[]) ?? []}
        answers={answers}
        onCommit={() => {}}
        onAdvance={() => {}}
        onCustomWork={(p) => setAnswers((a) => ({ ...a, ...p }))}
        industries={INDUSTRIES}
        onTagIndustry={onTagIndustry}
        industrySuggestions={industrySuggestions}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('L2/H7: custom_addon_editable + industry tag (10_06)', () => {
  it('the pencil edits name, cadence, price, and industry tag on a custom rule', () => {
    const onTagIndustry = vi.fn()
    render(
      <Harness
        onTagIndustry={onTagIndustry}
        initial={{
          customRecurringRules: [
            { title: 'Walk my dog', scheduleType: 'monthly', isBillable: true, unitPrice: 150, subtasks: [] },
          ],
        } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('custom-addon-edit-Walk my dog'))
    const form = screen.getByTestId('custom-addon-edit-form')
    expect(form).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Walk the client dog' } })
    fireEvent.change(screen.getByTestId('custom-addon-edit-cadence'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '200' } })
    fireEvent.change(screen.getByTestId('custom-addon-edit-industry'), { target: { value: 'Construction' } })
    fireEvent.click(screen.getByTestId('custom-addon-edit-save'))

    const rules = answersNow().customRecurringRules ?? []
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      title: 'Walk the client dog',
      scheduleType: 'weekly',
      isBillable: true,
      unitPrice: 200,
      industry: 'Construction',
    })
    // The tag joined the suggestion engine.
    expect(onTagIndustry).toHaveBeenCalledWith('Construction', 'Walk the client dog')
  })

  it('cancel leaves the rule untouched', () => {
    render(
      <Harness
        initial={{
          customRecurringRules: [{ title: 'Walk my dog', scheduleType: 'monthly', subtasks: [] }],
        } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('custom-addon-edit-Walk my dog'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Changed mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(answersNow().customRecurringRules?.[0]?.title).toBe('Walk my dog')
  })

  it('a custom: industry suggestion adds as a custom rule - never a service key', () => {
    render(
      <Harness
        initial={{}}
        industrySuggestions={[{ id: 9, serviceKey: 'custom:Therapist EOB split', explainer: 'A custom add-on from a prior intake.' }]}
      />,
    )
    fireEvent.click(screen.getByTestId('suggestion-add-custom:Therapist EOB split'))
    const rules = answersNow().customRecurringRules ?? []
    expect(rules).toEqual([expect.objectContaining({ title: 'Therapist EOB split', scheduleType: 'monthly' })])
    expect(answersNow().serviceKeys ?? []).not.toContain('custom:Therapist EOB split')
    // Added state: no double-add.
    fireEvent.click(screen.getByTestId('suggestion-add-custom:Therapist EOB split'))
    expect(answersNow().customRecurringRules).toHaveLength(1)
  })
})

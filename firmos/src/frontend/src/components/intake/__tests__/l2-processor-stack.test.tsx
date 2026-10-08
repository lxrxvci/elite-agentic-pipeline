import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

/**
 * L2 (B3, 10_06 00:09:18-00:10:01): the processor card is ONE alphabetized
 * vertical stack - click selects/highlights, pencil edits only the name,
 * add button at the bottom. No tiles, no dropdown, no name field.
 */

const renameMerchantProcessorAction = vi.fn()
vi.mock('@/server/actions/merchant-processors', () => ({
  renameMerchantProcessorAction: (...args: unknown[]) => renameMerchantProcessorAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PROCESSORS = [
  { id: 1, name: 'Clover' },
  { id: 2, name: 'Square' },
  { id: 3, name: 'Stripe' },
]

function Harness({ initial, processors = PROCESSORS.map((p) => ({ ...p })) }: { initial: WizardAnswers; processors?: { id: number; name: string }[] }) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial)
  const q = findQuestion('income', 'merchants')!
  return (
    <div>
      <QuestionScreen
        q={q}
        answers={answers}
        onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
        onAdvance={() => {}}
        onPickOption={() => {}}
        merchantProcessors={processors}
        onAddMerchantProcessor={async (name) => ({ id: 99, name })}
      />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </div>
  )
}

const answersNow = (): WizardAnswers => JSON.parse(screen.getByTestId('answers').textContent ?? '{}')

describe('L2/B3: processors_are_a_vertical_stack_with_pencil_edit (10_06 00:10:01)', () => {
  it('one alphabetized stack, no tiles/dropdown/name field; click selects with no re-typing, click again deselects', () => {
    render(<Harness initial={{ merchantAccounts: [] } as unknown as WizardAnswers} />)
    const stack = screen.getByTestId('processor-stack')
    // A single vertical list (ul), alphabetized rows, no tile grid or dropdown.
    expect(stack.tagName).toBe('UL')
    expect(stack.querySelector('[data-testid="processor-dropdown"]')).toBeNull()
    expect(screen.queryByLabelText('Processor')).toBeNull()
    expect(screen.queryByLabelText('Name')).toBeNull()
    const rows = screen.getAllByRole('checkbox').map((el) => el.textContent)
    expect(rows).toEqual(['Clover', 'Square', 'Stripe'])

    // Click selects - the committed row carries the processor's own name (C7).
    fireEvent.click(screen.getByTestId('processor-toggle-Square'))
    expect(answersNow().merchantAccounts).toEqual([{ name: 'Square', processor: 'Square', processorId: 2 }])
    expect(screen.getByTestId('processor-toggle-Square')).toHaveAttribute('aria-checked', 'true')

    // Click again deselects.
    fireEvent.click(screen.getByTestId('processor-toggle-Square'))
    expect(answersNow().merchantAccounts).toEqual([])
  })

  it('the pencil renames only the name - committed rows on this intake follow', async () => {
    renameMerchantProcessorAction.mockResolvedValue({ ok: true, data: { id: 2, name: 'Square POS' } })
    render(
      <Harness
        initial={{ merchantAccounts: [{ name: 'Square', processor: 'Square', processorId: 2 }] } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('processor-edit-Square'))
    const input = screen.getByLabelText('Rename Square')
    expect(input).toHaveValue('Square')
    fireEvent.change(input, { target: { value: 'Square POS' } })
    fireEvent.click(screen.getByTestId('processor-rename-save-2'))
    await waitFor(() => expect(renameMerchantProcessorAction).toHaveBeenCalledWith(2, 'Square POS'))
    await waitFor(() => expect(answersNow().merchantAccounts?.[0]?.name).toBe('Square POS'))
  })

  it('Add processor sits at the bottom; a new processor arrives selected', async () => {
    render(<Harness initial={{ merchantAccounts: [] } as unknown as WizardAnswers} />)
    fireEvent.click(screen.getByTestId('processor-add-open'))
    fireEvent.change(screen.getByLabelText('New processor name'), { target: { value: 'Helcim' } })
    fireEvent.click(screen.getByTestId('processor-add-submit'))
    await waitFor(() =>
      expect(answersNow().merchantAccounts).toEqual([{ name: 'Helcim', processor: 'Helcim', processorId: 99 }]),
    )
  })

  it('Continue blocks when nothing is selected (required when they take cards)', () => {
    render(<Harness initial={{ merchantAccounts: [] } as unknown as WizardAnswers} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.getByRole('alert').textContent).toContain('Pick at least one processor')
  })
})

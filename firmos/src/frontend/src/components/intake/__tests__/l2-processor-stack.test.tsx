import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

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

describe('Jason selector: merchant processor multi-select', () => {
  it('opens an alphabetized searchable list and toggles selections with checkboxes', () => {
    render(<Harness initial={{ merchantAccounts: [] } as unknown as WizardAnswers} />)
    fireEvent.click(screen.getByTestId('processor-input'))
    expect(
      Array.from(screen.getByTestId('processor-listbox').querySelectorAll('[role="option"]'))
        .slice(0, 3)
        .map((option) => option.textContent),
    ).toEqual([
      'Clover',
      'Square',
      'Stripe',
    ])

    fireEvent.click(screen.getByTestId('processor-option-Square'))
    expect(answersNow().merchantAccounts).toEqual([{ name: 'Square', processor: 'Square', processorId: 2 }])
    expect(screen.getByTestId('processor-option-Square')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('processor-listbox')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('processor-option-Square'))
    expect(answersNow().merchantAccounts).toEqual([])
  })

  it('the pencil renames only the name and committed rows follow', async () => {
    renameMerchantProcessorAction.mockResolvedValue({ ok: true, data: { id: 2, name: 'Square POS' } })
    render(
      <Harness
        initial={{ merchantAccounts: [{ name: 'Square', processor: 'Square', processorId: 2 }] } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('processor-input'))
    fireEvent.click(screen.getByTestId('processor-edit-Square'))
    const input = screen.getByLabelText('Rename Square')
    expect(input).toHaveValue('Square')
    fireEvent.change(input, { target: { value: 'Square POS' } })
    fireEvent.click(screen.getByTestId('processor-rename-save-2'))
    await waitFor(() => expect(renameMerchantProcessorAction).toHaveBeenCalledWith(2, 'Square POS'))
    await waitFor(() => expect(answersNow().merchantAccounts?.[0]?.name).toBe('Square POS'))
  })

  it('keeps renamed and newly added options after parent rerenders', async () => {
    renameMerchantProcessorAction.mockResolvedValue({ ok: true, data: { id: 2, name: 'Square POS' } })
    render(
      <Harness
        initial={{ merchantAccounts: [{ name: 'Square', processor: 'Square', processorId: 2 }] } as unknown as WizardAnswers}
      />,
    )
    fireEvent.click(screen.getByTestId('processor-input'))
    fireEvent.click(screen.getByTestId('processor-edit-Square'))
    fireEvent.change(screen.getByLabelText('Rename Square'), { target: { value: 'Square POS' } })
    fireEvent.click(screen.getByTestId('processor-rename-save-2'))
    await waitFor(() => expect(answersNow().merchantAccounts?.[0]?.name).toBe('Square POS'))
    fireEvent.click(screen.getByTestId('processor-add-toggle'))
    fireEvent.change(screen.getByTestId('processor-add-input'), { target: { value: 'Helcim' } })
    fireEvent.click(screen.getByTestId('processor-add-submit'))
    await waitFor(() => expect(answersNow().merchantAccounts).toHaveLength(2))
    expect(screen.getByTestId('processor-option-Square POS')).toBeVisible()
    expect(screen.getByTestId('processor-option-Helcim')).toBeVisible()
  })

  it('Add processor sits inside the dropdown and a new processor arrives selected', async () => {
    render(<Harness initial={{ merchantAccounts: [] } as unknown as WizardAnswers} />)
    fireEvent.click(screen.getByTestId('processor-input'))
    fireEvent.click(screen.getByTestId('processor-add-toggle'))
    fireEvent.change(screen.getByTestId('processor-add-input'), { target: { value: 'Helcim' } })
    fireEvent.click(screen.getByTestId('processor-add-submit'))
    await waitFor(() =>
      expect(answersNow().merchantAccounts).toEqual([{ name: 'Helcim', processor: 'Helcim', processorId: 99 }]),
    )
  })

  it('Continue allows no processors after the reconciliation choice', () => {
    render(<Harness initial={{ merchantAccounts: [], includeMerchantReconciliation: false } as unknown as WizardAnswers} />)
    fireEvent.click(screen.getByTestId('continue'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

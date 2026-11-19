import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EditQuestionDialog } from '../edit-overlay'
import type { WizardAnswers } from '../registry'

function Overlay({ onClose }: { onClose: () => void }) {
  const [answers, setAnswers] = useState<WizardAnswers>({
    recordBills: true,
    payBills: false,
    vendorAssignments: [{ vendorId: 1, vendorName: 'Portland General Electric', frequency: 'monthly' }],
  })
  return (
    <EditQuestionDialog
      target={{ chapterId: 'reporting', questionId: 'pay-bills' }}
      answers={answers}
      onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
      onClose={onClose}
      intakeId={7}
      vendorCatalog={[]}
      sopTemplates={[]}
    />
  )
}

describe('vendor review editing', () => {
  it('keeps the payment setup open after the yes choice', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} />)
    fireEvent.click(screen.getByTestId('option-yes'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('edit-overlay')).toHaveAttribute('data-question', 'pay-bills')
    expect(screen.getByTestId('pay-vendor-list')).toBeInTheDocument()
  })
})

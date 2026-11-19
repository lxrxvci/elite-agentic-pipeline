import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MultiChips } from '../screens'

describe('Jason selector: multiple-choice options', () => {
  it('MultiChips opens a searchable multi-select list with checkboxes', () => {
    render(
      <MultiChips
        options={[
          { value: 'card', label: 'Credit or debit cards' },
          { value: 'check', label: 'Checks' },
          { value: 'online', label: 'Online payments' },
        ]}
        values={['check']}
        onToggle={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Choices' }))
    const listbox = screen.getByTestId('multi-stack')
    expect(listbox).toHaveAttribute('role', 'listbox')
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(screen.getByTestId('chip-check')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('chip-card')).toHaveAttribute('aria-checked', 'false')
  })
})

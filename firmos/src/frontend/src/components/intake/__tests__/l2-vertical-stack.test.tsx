import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MultiChips } from '../screens'

/**
 * L2 (B2, 10_06 00:22:30-00:23:20): every multiple-choice list renders as a
 * vertical stack with row checkboxes - "all selectable options should just
 * be in a vertical stack when possible… uniform across this entire firm OS."
 */

describe('L2/B2: multiple-choice options are vertical stacks', () => {
  it('MultiChips renders a divided vertical list with checkbox rows, not a chip wrap', () => {
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
    const stack = screen.getByTestId('multi-stack')
    expect(stack.tagName).toBe('UL')
    const rows = screen.getAllByRole('checkbox')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveAttribute('aria-checked', 'true')
    expect(rows[0]).toHaveAttribute('aria-checked', 'false')
  })
})

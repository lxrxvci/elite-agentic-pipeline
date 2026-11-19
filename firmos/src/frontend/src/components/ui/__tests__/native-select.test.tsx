import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NativeSelect } from '../native-select'

describe('NativeSelect', () => {
  it('shows the placeholder option for an empty value', () => {
    render(
      <NativeSelect data-testid="manager" value="" onChange={() => {}}>
        <option value="">Assign after conversion</option>
        <option value="3">Dana Whitfield</option>
      </NativeSelect>,
    )
    expect(screen.getByTestId('manager')).toHaveValue('Assign after conversion')
  })

  it('preserves trigger sizing and text styles through the shared control', () => {
    render(
      <NativeSelect data-testid="manager" className="h-7 w-36 text-xs" value="3" onChange={() => {}}>
        <option value="3">Dana Whitfield</option>
      </NativeSelect>,
    )
    expect(screen.getByTestId('manager')).toHaveClass('h-7', 'w-36', 'text-xs')
    expect(screen.getByTestId('manager')).toHaveValue('Dana Whitfield')
  })

  it('preserves authored numeric order through the shared control', () => {
    const days = Array.from({ length: 31 }, (_, index) => String(index + 1))
    render(
      <NativeSelect aria-label="Period start" value="" onChange={() => {}}>
        <option value="">Select…</option>
        {days.map((day) => <option key={day} value={day}>{day}</option>)}
      </NativeSelect>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Period start' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Select…', ...days])
  })
})

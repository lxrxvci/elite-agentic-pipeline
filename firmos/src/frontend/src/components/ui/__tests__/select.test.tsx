import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../select'

describe('Select ordering', () => {
  it('preserves authored chronological order', () => {
    render(
      <Select value="" onValueChange={() => {}}>
        <SelectTrigger aria-label="Week of month" />
        <SelectContent>
          <SelectItem value="1">First</SelectItem>
          <SelectItem value="2">Second</SelectItem>
          <SelectItem value="3">Third</SelectItem>
          <SelectItem value="4">Fourth</SelectItem>
          <SelectItem value="-1">Last</SelectItem>
        </SelectContent>
      </Select>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Week of month' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'First',
      'Second',
      'Third',
      'Fourth',
      'Last',
    ])
  })

  it('alphabetizes catalogs while keeping the all-choice sentinel first', () => {
    render(
      <Select optionOrder="alphabetical" value="" onValueChange={() => {}}>
        <SelectTrigger aria-label="Staff" />
        <SelectContent>
          <SelectItem value="z">Zulu</SelectItem>
          <SelectItem value="all">All staff</SelectItem>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Staff' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All staff',
      'Alpha',
      'Zulu',
    ])
  })
})

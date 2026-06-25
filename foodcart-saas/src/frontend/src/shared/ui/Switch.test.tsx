import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from './Switch'

describe('Switch', () => {
  it('toggles on click', async () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onChange} aria-label="Open" />)
    await userEvent.click(screen.getByRole('switch', { name: 'Open' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

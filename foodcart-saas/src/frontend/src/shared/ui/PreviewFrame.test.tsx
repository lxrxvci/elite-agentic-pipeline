import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewFrame } from './PreviewFrame'

describe('PreviewFrame', () => {
  it('renders iframe and toggles viewport', async () => {
    render(<PreviewFrame url="/sites/demo" title="Preview" />)
    expect(screen.getByTitle('Preview')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Desktop' }))
    expect(screen.getByRole('radio', { name: 'Desktop' })).toHaveAttribute('aria-checked', 'true')
  })
})

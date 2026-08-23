import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('renders with label and forwards input', async () => {
    function Wrapper() {
      const [value, setValue] = useState('')
      return <Textarea label="Notes" value={value} onChange={(e) => setValue(e.target.value)} />
    }
    render(<Wrapper />)
    const textarea = screen.getByLabelText('Notes')
    await userEvent.type(textarea, 'hello')
    expect(textarea).toHaveValue('hello')
  })

  it('shows error message', () => {
    render(<Textarea label="Notes" error="Required" />)
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})

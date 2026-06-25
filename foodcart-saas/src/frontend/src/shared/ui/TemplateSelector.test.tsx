import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateSelector } from './TemplateSelector'
import type { TemplateOption } from './TemplateSelector'

const TEMPLATES: TemplateOption[] = [
  { id: 'banhmi', name: 'Banh Mi', mood: 'Bold', thumbnail: '/t1.svg' },
  { id: 'real-indian', name: 'Real Indian', mood: 'Warm', thumbnail: '/t2.svg' },
]

describe('TemplateSelector', () => {
  it('renders all templates as radio group', () => {
    render(<TemplateSelector templates={TEMPLATES} selectedId="banhmi" onSelect={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: /choose a template/i })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('calls onSelect when a template is chosen', async () => {
    const onSelect = vi.fn()
    render(<TemplateSelector templates={TEMPLATES} selectedId="banhmi" onSelect={onSelect} />)
    await userEvent.click(screen.getAllByRole('radio')[1])
    expect(onSelect).toHaveBeenCalledWith('real-indian')
  })
})

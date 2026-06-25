import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIAssistantPanel } from './AIAssistantPanel'

describe('AIAssistantPanel', () => {
  it('does not render when closed', () => {
    render(<AIAssistantPanel open={false} onClose={vi.fn()} messages={[]} onSend={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.queryByLabelText(/AI Website Assistant/i)).not.toBeInTheDocument()
  })

  it('renders messages and diff preview', () => {
    render(
      <AIAssistantPanel
        open
        onClose={vi.fn()}
        messages={[{ role: 'user', content: 'Add vegan section' }]}
        preview={{ summary: 'Add vegan section', added: ['Tofu Bowl $12'], removed: [] }}
        onSend={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    )
    expect(screen.getAllByText('Add vegan section')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /looks good/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revise/i })).toBeInTheDocument()
  })

  it('calls onSend when form submitted', async () => {
    const onSend = vi.fn()
    render(<AIAssistantPanel open onClose={vi.fn()} messages={[]} onSend={onSend} onApprove={vi.fn()} onReject={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/Assistant request/i), 'Change headline')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('Change headline')
  })
})

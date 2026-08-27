import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChatPerson } from '@/server/chat'

import { Composer } from '../composer'

const members: ChatPerson[] = [
  { id: 1, name: 'Mara Ellison', initials: 'ME', role: 'owner' },
  { id: 4, name: 'Sofia Lindqvist', initials: 'SL', role: 'bookkeeper' },
  { id: 5, name: 'Jorge Medina', initials: 'JM', role: 'bookkeeper' },
]

function renderComposer(onSend = vi.fn().mockResolvedValue(true)) {
  render(<Composer members={members} meId={1} onSend={onSend} />)
  return onSend
}

describe('Composer', () => {
  it('sends on Enter and clears the draft', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()
    const box = screen.getByLabelText('Message')
    await user.type(box, 'Close packets go out Friday')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('Close packets go out Friday', 'Close packets go out Friday', null)
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()
    const box = screen.getByLabelText('Message')
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(onSend).not.toHaveBeenCalled()
    expect(box).toHaveValue('line one\nline two')
  })

  it('restores the draft when the send fails', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer(vi.fn().mockResolvedValue(false))
    const box = screen.getByLabelText('Message')
    await user.type(box, 'this will fail')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(box).toHaveValue('this will fail'))
  })

  it('opens the mention typeahead on @ and inserts the §16 id form on send', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()
    const box = screen.getByLabelText('Message')
    await user.type(box, '@lin')
    const listbox = await screen.findByRole('listbox', { name: 'Mention a person' })
    expect(listbox).toHaveTextContent('Sofia Lindqvist')
    // Mara is the viewer: excluded from the typeahead.
    expect(listbox).not.toHaveTextContent('Mara Ellison')

    await user.keyboard('{Enter}') // pick Sofia
    await waitFor(() => expect(box).toHaveValue('@Sofia Lindqvist '))
    await user.type(box, 'please review the reconciliations')
    await user.keyboard('{Enter}') // send
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        '@Sofia Lindqvist please review the reconciliations',
        '@(4) please review the reconciliations',
        null,
      ),
    )
  })

  it('navigates the typeahead with arrow keys and dismisses with Escape', async () => {
    const user = userEvent.setup()
    renderComposer()
    const box = screen.getByLabelText('Message')
    await user.type(box, '@')
    await screen.findByRole('listbox', { name: 'Mention a person' })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Jorge Medina/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Mention a person' })).not.toBeInTheDocument(),
    )
  })

  it('shows an attachment chip after a file is picked', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()
    const file = new File([new Uint8Array([0x25, 0x50])], 'receipt.pdf', {
      type: 'application/pdf',
    })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'receipt attached')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('receipt attached', 'receipt attached', file),
    )
  })

  it('does not send an empty message', async () => {
    const user = userEvent.setup()
    const onSend = renderComposer()
    await user.click(screen.getByLabelText('Send message'))
    expect(onSend).not.toHaveBeenCalled()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientNotesPanel } from '../client-notes-panel'

/**
 * K7 (V18/C9 tail): the client record's notes surface - read, add, edit in
 * place (intake notes land here at conversion; they were write-only before).
 */

const addClientNoteAction = vi.fn()
const editClientNoteAction = vi.fn()

vi.mock('@/server/actions/client-notes', () => ({
  addClientNoteAction: (...args: unknown[]) => addClientNoteAction(...args),
  editClientNoteAction: (...args: unknown[]) => editClientNoteAction(...args),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const NOTES = [
  {
    id: 1,
    body: 'Referred by Cascade Tax Group. Wants close by the 10th.',
    authorName: 'Dana Whitfield',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  addClientNoteAction.mockResolvedValue({ ok: true, data: { id: 9 } })
  editClientNoteAction.mockResolvedValue({ ok: true, data: { done: true } })
})

describe('ClientNotesPanel', () => {
  it('notes render with author + date; add writes through the action', async () => {
    render(<ClientNotesPanel clientId={5} notes={NOTES} />)
    expect(screen.getByTestId('client-note-1')).toHaveTextContent('Referred by Cascade Tax Group')
    expect(screen.getByTestId('client-note-1')).toHaveTextContent('Dana Whitfield')

    fireEvent.change(screen.getByTestId('client-note-input'), { target: { value: 'Texts, never emails.' } })
    fireEvent.click(screen.getByTestId('client-note-add'))
    await waitFor(() => expect(addClientNoteAction).toHaveBeenCalledWith(5, 'Texts, never emails.'))
  })

  it('edits in place', async () => {
    render(<ClientNotesPanel clientId={5} notes={NOTES} />)
    fireEvent.click(screen.getByTestId('client-note-edit-1'))
    fireEvent.change(screen.getByLabelText('Edit the note'), { target: { value: 'Close by the 5th now.' } })
    fireEvent.click(screen.getByLabelText('Save the note'))
    await waitFor(() => expect(editClientNoteAction).toHaveBeenCalledWith(1, 'Close by the 5th now.'))
  })

  it('the empty state says so', () => {
    render(<ClientNotesPanel clientId={5} notes={[]} />)
    expect(screen.getByTestId('client-notes-empty')).toHaveTextContent('No notes yet')
  })
})

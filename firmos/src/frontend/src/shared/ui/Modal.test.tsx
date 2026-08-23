import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/shared/lib/test-utils'
import { Modal } from './Modal'

describe('Modal', () => {
  const showModal = vi.fn()
  const close = vi.fn()

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = showModal
    HTMLDialogElement.prototype.close = close
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the dialog when open is true', () => {
    render(<Modal open title="Test" onClose={() => {}}>content</Modal>)
    expect(showModal).toHaveBeenCalled()
  })

  it('closes the dialog when open is false', () => {
    render(<Modal open={false} title="Test" onClose={() => {}}>content</Modal>)
    expect(close).toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(<Modal open title="Test" onClose={onClose}>content</Modal>)
    await userEvent.click(screen.getByRole('button', { name: /close dialog/i, hidden: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders footer when provided', () => {
    render(
      <Modal open title="Test" onClose={() => {}} footer={<button>Action</button>}>
        content
      </Modal>
    )
    expect(screen.getByRole('button', { name: /action/i, hidden: true })).toBeInTheDocument()
  })
})

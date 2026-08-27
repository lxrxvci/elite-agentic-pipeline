import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SopAdmin, type SopTemplateItem } from '../sop-admin'

// Radix Select calls pointer-capture APIs jsdom does not implement.
beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
})

vi.mock('@/server/actions/templates', () => ({
  applySopToClientAction: vi.fn(),
  createSopTemplateAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  deleteSopTemplateAction: vi.fn(),
  updateSopTemplateAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

import { createSopTemplateAction, updateSopTemplateAction } from '@/server/actions/templates'

const CLIENTS = [{ id: 1, name: 'Harborline Marine Supply' }]

const KEYED: SopTemplateItem = {
  id: 1,
  title: 'Chevron WEX fuel card close',
  content: 'Download the WEX statement.',
  position: 0,
  isActive: true,
  institutionKey: 'chevron wex',
  changeNote: 'Added the walkthrough video.',
  updatedAt: '2026-08-10T12:00:00.000Z',
}

const UNKEYED: SopTemplateItem = {
  id: 2,
  title: 'Generic close steps',
  content: null,
  position: 1,
  isActive: true,
  institutionKey: null,
  changeNote: null,
  updatedAt: '2026-08-01T12:00:00.000Z',
}

describe('SopAdmin institution keys + staleness failsafe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the institution chip and "Updated" line only when the data exists', () => {
    render(<SopAdmin sops={[KEYED, UNKEYED]} clients={CLIENTS} canEdit={true} />)
    const chips = screen.getAllByTestId('sop-institution-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0]).toHaveTextContent('chevron wex')

    const updated = screen.getAllByTestId('sop-updated')
    expect(updated[0]).toHaveTextContent('Updated Aug 10, 2026 - Added the walkthrough video.')
    expect(updated[1]).toHaveTextContent('Updated Aug 1, 2026')
    expect(updated[1]).not.toHaveTextContent(' - ')
  })

  it('creates an SOP with the institution key and change note', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[]} clients={CLIENTS} canEdit={true} />)
    await user.click(screen.getByRole('button', { name: /New SOP/ }))
    await user.type(screen.getByLabelText('Title'), 'WEX close')
    await user.type(screen.getByLabelText('Institution key'), 'Chevron WEX')
    await user.type(screen.getByLabelText('Change note'), 'First version')
    await user.click(screen.getByRole('button', { name: 'Create SOP' }))
    expect(createSopTemplateAction).toHaveBeenCalledWith({
      title: 'WEX close',
      content: null,
      position: 0,
      institutionKey: 'Chevron WEX',
      changeNote: 'First version',
    })
  })

  it('pre-fills the institution key on edit and sends it back', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[KEYED]} clients={CLIENTS} canEdit={true} />)
    await user.click(screen.getByRole('button', { name: 'Edit Chevron WEX fuel card close' }))
    const keyInput = screen.getByLabelText('Institution key')
    expect(keyInput).toHaveValue('chevron wex')
    await user.clear(keyInput)
    await user.type(keyInput, 'WEX')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateSopTemplateAction).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ institutionKey: 'WEX', changeNote: 'Added the walkthrough video.' }),
    )
  })
})

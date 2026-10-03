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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

vi.mock('@/server/actions/templates', () => ({
  applySopToClientAction: vi.fn(),
  createSopTemplateAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  deleteSopTemplateAction: vi.fn(),
  updateSopTemplateAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  flagSopStaleAction: vi.fn(),
  normalizeSopInstitutionKeysAction: vi.fn(),
}))

vi.mock('@/server/actions/institutions', () => ({
  addInstitutionAction: vi.fn(),
}))

import { addInstitutionAction } from '@/server/actions/institutions'
import { createSopTemplateAction, updateSopTemplateAction } from '@/server/actions/templates'

const CLIENTS = [{ id: 1, name: 'Harborline Marine Supply' }]

const INSTITUTIONS = [
  { id: 1, name: 'Chevron WEX' },
  { id: 2, name: 'Columbia Bank' },
]

const ACCOUNT_COUNTS: Record<string, number> = {
  'chevron wex': 2,
  'columbia bank': 0,
}

const PROPS = { clients: CLIENTS, institutions: INSTITUTIONS, accountCounts: ACCOUNT_COUNTS }

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
    render(<SopAdmin sops={[KEYED, UNKEYED]} videosBySop={{}} merchantProcessors={[]} canEdit={true} {...PROPS} />)
    const chips = screen.getAllByTestId('sop-institution-chip')
    expect(chips).toHaveLength(1)
    // The chip renders the pretty institutions-table name, not the raw key.
    expect(chips[0]).toHaveTextContent('Chevron WEX')

    const updated = screen.getAllByTestId('sop-updated')
    expect(updated[0]).toHaveTextContent('Updated Aug 10, 2026 - Added the walkthrough video.')
    expect(updated[1]).toHaveTextContent('Updated Aug 1, 2026')
    expect(updated[1]).not.toHaveTextContent(' - ')
  })

  it('creates an SOP with a picked institution, previewing the account match', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[]} videosBySop={{}} merchantProcessors={[]} canEdit={true} {...PROPS} />)
    await user.click(screen.getByRole('button', { name: /New SOP/ }))
    await user.type(screen.getByLabelText('Title'), 'WEX close')

    // The institution field is the shared dropdown, not free text.
    await user.click(screen.getByLabelText('Institution'))
    await user.click(screen.getByRole('option', { name: 'Chevron WEX' }))
    // Live match preview from the server-provided account counts.
    expect(screen.getByTestId('institution-match-preview')).toHaveTextContent(
      'Matches 2 client accounts at this bank.',
    )

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

  it('previews "no client accounts yet" for a bank with none', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[]} videosBySop={{}} merchantProcessors={[]} canEdit={true} {...PROPS} />)
    await user.click(screen.getByRole('button', { name: /New SOP/ }))
    await user.click(screen.getByLabelText('Institution'))
    await user.click(screen.getByRole('option', { name: 'Columbia Bank' }))
    expect(screen.getByTestId('institution-match-preview')).toHaveTextContent(
      'No client accounts at this bank yet.',
    )
  })

  it('adds a brand-new bank inline and keys the SOP to it', async () => {
    const user = userEvent.setup()
    vi.mocked(addInstitutionAction).mockResolvedValue({
      ok: true,
      data: { id: 3, name: 'First Interstate Bank' },
    })
    render(<SopAdmin sops={[]} videosBySop={{}} merchantProcessors={[]} canEdit={true} {...PROPS} />)
    await user.click(screen.getByRole('button', { name: /New SOP/ }))
    await user.type(screen.getByLabelText('Title'), 'New bank procedure')

    await user.click(screen.getByLabelText('Institution'))
    await user.click(screen.getByTestId('bank-add-toggle-0'))
    await user.type(screen.getByLabelText('New bank name'), 'First Interstate Bank')
    await user.click(screen.getByTestId('bank-add-submit'))

    expect(addInstitutionAction).toHaveBeenCalledWith('First Interstate Bank')
    // The dropdown selects the freshly created row...
    expect(screen.getByTestId('bank-select-0')).toHaveTextContent('First Interstate Bank')
    // ...and a zero-account preview follows a brand-new bank.
    expect(screen.getByTestId('institution-match-preview')).toHaveTextContent(
      'No client accounts at this bank yet.',
    )

    await user.click(screen.getByRole('button', { name: 'Create SOP' }))
    expect(createSopTemplateAction).toHaveBeenCalledWith(
      expect.objectContaining({ institutionKey: 'First Interstate Bank' }),
    )
  })

  it('pre-fills a legacy key on edit (no matching institution row) and sends it back', async () => {
    const user = userEvent.setup()
    const legacy: SopTemplateItem = { ...KEYED, institutionKey: 'legacy bank' }
    render(<SopAdmin sops={[legacy]} videosBySop={{}} merchantProcessors={[]} canEdit={true} {...PROPS} />)
    await user.click(screen.getByRole('button', { name: 'Edit Chevron WEX fuel card close' }))
    // Free-text fallback: the dropdown shows the raw key as the current value.
    expect(screen.getByTestId('bank-select-0')).toHaveTextContent('legacy bank')
    // Re-picking a real bank replaces the legacy key.
    await user.click(screen.getByLabelText('Institution'))
    await user.click(screen.getByRole('option', { name: 'Columbia Bank' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateSopTemplateAction).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ institutionKey: 'Columbia Bank' }),
    )
  })
})

describe('K2: videos + merchant-processor SOP keys (H3)', () => {
  const SQUARE = [{ id: 9, name: 'Square' }]

  it('merchant processors appear as key options (a "Square" SOP flows to merchant accounts)', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[]} videosBySop={{}} merchantProcessors={SQUARE} canEdit={true} {...PROPS} />)
    await user.click(screen.getByRole('button', { name: /New SOP/ }))
    await user.click(screen.getByRole('button', { name: /Pick the institution|Select|Institution/i }))
    expect(await screen.findByRole('option', { name: 'Square' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chevron WEX' })).toBeInTheDocument()
  })

  it('the Videos button counts recordings and the dialog lists them; Record SOP opens the recorder', async () => {
    const user = userEvent.setup()
    render(
      <SopAdmin
        sops={[KEYED]}
        videosBySop={{ 1: [{ id: 44, title: 'WEX portal walkthrough', durationSecs: 62, sizeBytes: 900 * 1024 }] }}
        merchantProcessors={SQUARE}
        canEdit={true}
        {...PROPS}
      />,
    )
    expect(screen.getByTestId('sop-videos-open-1')).toHaveTextContent('Videos (1)')

    await user.click(screen.getByTestId('sop-videos-open-1'))
    expect(await screen.findByTestId('sop-videos-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('sop-video-44')).toHaveTextContent('WEX portal walkthrough')
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/sop-videos/44')
    await user.keyboard('{Escape}')

    await user.click(screen.getByTestId('sop-record-open-1'))
    expect(await screen.findByTestId('sop-recorder-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('sop-record-start')).toBeInTheDocument()
  })

  it('an empty video library says so, and hides Record SOP without the edit flag', async () => {
    const user = userEvent.setup()
    render(<SopAdmin sops={[KEYED]} videosBySop={{}} merchantProcessors={[]} canEdit={false} {...PROPS} />)
    expect(screen.queryByTestId('sop-record-open-1')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('sop-videos-open-1'))
    expect(await screen.findByTestId('sop-videos-empty')).toHaveTextContent('No videos yet')
  })
})

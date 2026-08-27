import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deferAccountStatementsAction } from '@/server/actions/statements'

import { DeferPopover } from '../defer-popover'

vi.mock('@/server/actions/statements', () => ({
  deferAccountStatementsAction: vi.fn(),
}))

const mockDefer = vi.mocked(deferAccountStatementsAction)

function renderPopover(deferredUntil: string | null = null) {
  return render(
    <DeferPopover
      accountId={7}
      accountName="Operating Checking"
      deferredUntil={deferredUntil}
      today="2026-08-23"
    />,
  )
}

beforeEach(() => {
  mockDefer.mockReset()
})

describe('DeferPopover', () => {
  it('defers until the chosen date', async () => {
    const user = userEvent.setup()
    mockDefer.mockResolvedValue({ ok: true, data: null })
    renderPopover()

    await user.click(screen.getByTestId('defer-trigger'))
    const input = screen.getByLabelText('Defer statements until')
    expect(input).toHaveAttribute('min', '2026-08-23')
    await user.type(input, '2026-09-15')
    await user.click(screen.getByTestId('defer-submit'))

    await waitFor(() => expect(mockDefer).toHaveBeenCalledWith(7, '2026-09-15'))
  })

  it('shows the until-date on the trigger when deferred and offers Clear', async () => {
    const user = userEvent.setup()
    mockDefer.mockResolvedValue({ ok: true, data: null })
    renderPopover('2026-09-01')

    const trigger = screen.getByTestId('defer-trigger')
    expect(trigger).toHaveTextContent('Sep 1')
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(mockDefer).toHaveBeenCalledWith(7, null))
  })

  it('surfaces server errors verbatim and stays open', async () => {
    const user = userEvent.setup()
    mockDefer.mockResolvedValue({ ok: false, error: 'The deferral date must be a valid date (YYYY-MM-DD).' })
    renderPopover()

    await user.click(screen.getByTestId('defer-trigger'))
    await user.type(screen.getByLabelText('Defer statements until'), '2026-09-15')
    await user.click(screen.getByTestId('defer-submit'))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The deferral date must be a valid date (YYYY-MM-DD).',
      ),
    )
    expect(screen.getByTestId('defer-popover')).toBeInTheDocument()
  })
})

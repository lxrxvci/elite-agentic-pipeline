import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CommissionTierBadge, tierStatus } from '../commission-tier-badge'

/**
 * HANDOFF §6.6 tier table: 100 -> 50%, 90-99 -> 45%, 80-89 -> 40%, below
 * (and no data) -> 35%. The badge maps rate bands onto the status language.
 */
describe('tierStatus', () => {
  it('maps the tier rates to status tokens', () => {
    expect(tierStatus(50)).toBe('on_track')
    expect(tierStatus(45)).toBe('on_track')
    expect(tierStatus(40)).toBe('due_soon')
    expect(tierStatus(35)).toBe('overdue')
  })
})

describe('CommissionTierBadge', () => {
  it('renders the 50% tier as on-track with a text label (never color alone)', () => {
    render(<CommissionTierBadge rate={50} usedOverride={false} />)
    const badge = screen.getByText('50% tier')
    expect(badge.closest('[data-status]')).toHaveAttribute('data-status', 'on_track')
  })

  it('renders the 45% tier as on-track', () => {
    render(<CommissionTierBadge rate={45} usedOverride={false} />)
    expect(screen.getByText('45% tier').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'on_track',
    )
  })

  it('renders the 40% tier as due-soon', () => {
    render(<CommissionTierBadge rate={40} usedOverride={false} />)
    expect(screen.getByText('40% tier').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'due_soon',
    )
  })

  it('renders the 35% floor (below 80% or no data) as overdue', () => {
    render(<CommissionTierBadge rate={35} usedOverride={false} />)
    expect(screen.getByText('35% tier').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'overdue',
    )
  })

  it('renders a per-user override as a neutral badge, not a status color', () => {
    render(<CommissionTierBadge rate={42} usedOverride />)
    const badge = screen.getByText('Override 42%')
    expect(badge.closest('[data-status]')).toBeNull()
  })
})

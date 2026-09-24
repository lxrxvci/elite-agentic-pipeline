import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConvertDialog } from '../convert-dialog'

/**
 * Convert dialog assignment step (E13): candidate options carry their
 * current open-work count so assignment never overloads one person by
 * default. The convert action itself is covered by the server suite.
 */

vi.mock('@/server/actions/intake', () => ({
  convertIntake: vi.fn(),
}))

describe('ConvertDialog assignment workload (E13)', () => {
  it('renders each candidate with their open-work count', () => {
    render(
      <ConvertDialog
        intakeId={1}
        intakeName="Acme Corp"
        managers={[{ id: 3, name: 'Dana Whitfield', openCount: 2 }]}
        bookkeepers={[
          { id: 5, name: 'Jorge Medina', openCount: 12 },
          { id: 6, name: 'Sofia Lindqvist', openCount: 4 },
        ]}
        open
        onOpenChange={() => {}}
      />,
    )

    const managerSelect = screen.getByTestId('select-manager')
    expect(selectOptions(managerSelect)).toContain('Dana Whitfield (2 open)')
    const bookkeeperSelect = screen.getByTestId('select-bookkeeper')
    expect(selectOptions(bookkeeperSelect)).toContain('Jorge Medina (12 open)')
    expect(selectOptions(bookkeeperSelect)).toContain('Sofia Lindqvist (4 open)')
  })

  it('falls back to the plain name when no count is available', () => {
    render(
      <ConvertDialog
        intakeId={1}
        intakeName="Acme Corp"
        managers={[{ id: 3, name: 'Dana Whitfield' }]}
        bookkeepers={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    expect(screen.getByTestId('select-manager')).toHaveTextContent('Dana Whitfield')
    expect(screen.getByTestId('select-manager')).not.toHaveTextContent('open)')
  })
})

function selectOptions(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll('option')).map((o) => o.textContent ?? '')
}

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ClientYearGrid, CloseStep } from '@/server/year-grid'

import { CloseStepper, closeStepTitleKey } from '../close-stepper'
import { makeCloseStep, makeCloseSteps, makeYearGrid } from './fixtures'

/**
 * Build a grid whose August column carries the given close steps; every
 * other column keeps the zeroed not_due fixture.
 */
function gridWithAugustSteps(steps: CloseStep[]): ClientYearGrid {
  const base = makeYearGrid()
  return makeYearGrid({
    closeSteps: base.closeSteps.map((cs) => (cs.month === 8 ? makeCloseSteps(8, {}, steps) : cs)),
  })
}

function renderStepper(grid: ClientYearGrid = makeYearGrid()) {
  return render(
    <CloseStepper
      grid={grid}
      prevYearHref="/clients/1?tab=work&year=2025"
      nextYearHref="/clients/1?tab=work&year=2027"
    />,
  )
}

describe('CloseStepper render states', () => {
  it('opens on the current work period with all four segments in guided order', () => {
    renderStepper()
    expect(screen.getByTestId('close-stepper')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Close Aug 2026' })).toBeInTheDocument()
    const steps = screen.getAllByTestId('close-step')
    expect(steps.map((s) => s.getAttribute('data-step'))).toEqual([
      'categorize',
      'reconcile',
      'questions',
      'reports',
    ])
    // 0/4: nothing done yet.
    expect(screen.getByTestId('close-stepper-count')).toHaveTextContent('0 of 4 steps done')
    for (const s of steps) expect(s).toHaveAttribute('data-state', 'not_due')
  })

  it('shows 2/4 with per-step state lines and a half-filled progress line', () => {
    renderStepper(
      gridWithAugustSteps([
        makeCloseStep('categorize', 'complete', { total: 4, completed: 4 }),
        makeCloseStep('reconcile', 'complete', { total: 2, completed: 2 }),
        makeCloseStep('questions', 'in_progress', { total: 3, completed: 1, open: 2 }),
        makeCloseStep('reports', 'not_due'),
      ]),
    )
    expect(screen.getByTestId('close-stepper-count')).toHaveTextContent('2 of 4 steps done')
    const steps = screen.getAllByTestId('close-step')
    expect(steps[0]).toHaveAttribute('data-state', 'complete')
    expect(steps[1]).toHaveAttribute('data-state', 'complete')
    expect(steps[2]).toHaveAttribute('data-state', 'in_progress')
    expect(steps[2]).toHaveTextContent('1 of 3 done')
    // Two of three gaps filled: 2/3 of the 75%-wide track.
    expect(screen.getByTestId('close-steps-fill')).toHaveStyle({ width: '50%' })
  })

  it('celebrates when all four steps complete: green segments plus the closed line', () => {
    renderStepper(
      gridWithAugustSteps([
        makeCloseStep('categorize', 'complete', { total: 4, completed: 4 }),
        makeCloseStep('reconcile', 'complete', { total: 2, completed: 2 }),
        makeCloseStep('questions', 'complete', { total: 1, completed: 1 }),
        makeCloseStep('reports', 'complete', { total: 1, completed: 1 }),
      ]),
    )
    expect(screen.getByTestId('close-stepper-closed')).toHaveTextContent('Books closed for Aug 2026')
    expect(screen.queryByTestId('close-stepper-count')).not.toBeInTheDocument()
    for (const s of screen.getAllByTestId('close-step')) {
      expect(s).toHaveAttribute('data-state', 'complete')
    }
  })

  it('labels waiting, behind, and not-due segments with text, never color alone', () => {
    renderStepper(
      gridWithAugustSteps([
        makeCloseStep('categorize', 'behind', { total: 4, completed: 1, open: 3, overdue: 2 }),
        makeCloseStep('reconcile', 'waiting', { total: 1, waiting: 1 }),
        makeCloseStep('questions', 'in_progress', { total: 2, completed: 1, open: 1 }),
        makeCloseStep('reports', 'not_due'),
      ]),
    )
    expect(screen.getByLabelText('Categorize Transactions: 2 overdue')).toBeInTheDocument()
    expect(screen.getByLabelText('Reconcile Accounts: Waiting on client')).toBeInTheDocument()
    expect(screen.getByLabelText('Client Questions: 1 of 2 done')).toBeInTheDocument()
    expect(screen.getByLabelText('Send Reports: Not due yet')).toBeInTheDocument()
  })

  it('gates the progress-line motion behind motion-safe (reduced-motion no-op)', () => {
    renderStepper()
    expect(screen.getByTestId('close-steps-fill').className).toContain('motion-safe:transition-[width]')
  })
})

describe('CloseStepper month navigation', () => {
  it('steps through the year with the arrows', async () => {
    const user = userEvent.setup()
    renderStepper()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'Close Jul 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'Close Aug 2026' })).toBeInTheDocument()
  })

  it('crosses the year boundary through the grid year links', () => {
    // January 10 anchors on the prior work period (RULE 2): December.
    renderStepper(makeYearGrid({ today: '2026-01-10' }))
    expect(screen.getByRole('heading', { name: 'Close Dec 2026' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      '/clients/1?tab=work&year=2027',
    )
  })
})

describe('closeStepTitleKey', () => {
  it('maps the four recurring close-step task titles, ignoring case and padding', () => {
    expect(closeStepTitleKey('Categorize Transactions')).toBe('categorize')
    expect(closeStepTitleKey('reconcile accounts')).toBe('reconcile')
    expect(closeStepTitleKey('  Client Questions ')).toBe('questions')
    expect(closeStepTitleKey('Send Reports')).toBe('reports')
    expect(closeStepTitleKey('Client Questions follow-up')).toBeNull()
    expect(closeStepTitleKey('Weekly deposit review')).toBeNull()
  })
})

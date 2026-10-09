import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { equitySeedPlan } from '@/shared/lib/account-types'
import { maskTaxId } from '@/shared/lib/mask'
import { findQuestion, flattenScreens, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'
import { ReviewScreen } from '../review-screen'

/**
 * L5 (10_06): J1 EIN hide/unhide (01:07:49), J2 the balance sheet's
 * accounting-equation sub-boxes (01:09:04), J3 the equity setup questions
 * driving conversion seeds (01:10:10).
 */

vi.mock('@/server/actions/intake', () => ({
  checkDuplicates: vi.fn(async () => ({ ok: true, data: [] })),
  submitIntakeForReview: vi.fn(async () => ({ ok: true, data: {} })),
}))
vi.mock('@/server/actions/correspondence', () => ({
  sendIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true as const, data: { correspondenceId: 5, to: 'wren@example.com' } })),
  previewIntakeQuoteEmailAction: vi.fn(async () => ({ ok: true as const, data: { to: 'wren@example.com', subject: 's', body: 'b' } })),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderReview(answers: WizardAnswers) {
  return render(
    <ReviewScreen
      intakeId={1}
      answers={answers}
      quote={null}
      status="draft"
      canConvert={false}
      managers={[]}
      bookkeepers={[]}
      clientId={null}
      onEdit={() => {}}
    />,
  )
}

describe('L5/J1: ein_masked_until_toggled (10_06 01:07:49)', () => {
  it('maskTaxId bullets all but the last two digits, keeping the EIN dash', () => {
    expect(maskTaxId('12-3456789')).toBe('••-•••••89')
    // A dashless 9-digit EIN normalizes to the canonical dashed layout.
    expect(maskTaxId('123456789')).toBe('••-•••••89')
    expect(maskTaxId('')).toBe('••')
  })

  it('the review row masks the EIN until the toggle reveals it, then re-hides', () => {
    renderReview({
      legalName: 'Mask Co',
      engagementType: 'bookkeeping',
      taxStructure: 'LLC',
      taxId: '12-3456789',
    } as WizardAnswers)
    // The row renders the masked value - never the raw number.
    expect(screen.getByTestId('review-ein-text')).toHaveTextContent('••-•••••89')
    expect(screen.queryByText('12-3456789')).toBeNull()

    fireEvent.click(screen.getByTestId('review-ein-toggle'))
    expect(screen.getByTestId('review-ein-text')).toHaveTextContent('12-3456789')
    fireEvent.click(screen.getByTestId('review-ein-toggle'))
    expect(screen.getByTestId('review-ein-text')).toHaveTextContent('••-•••••89')
  })

  it('the intake field types password-style with a hide/unhide toggle', () => {
    function Harness() {
      const [answers, setAnswers] = useState<WizardAnswers>({ engagementType: 'bookkeeping' } as WizardAnswers)
      return (
        <QuestionScreen
          q={findQuestion('entity', 'tax-id')!}
          answers={answers}
          onApply={(p) => setAnswers((a) => ({ ...a, ...p }))}
          onAdvance={() => {}}
          onPickOption={() => {}}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByTestId('masked-input-taxId')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.change(input, { target: { value: '12-3456789' } })
    // Typing stays masked; the toggle reveals for verification.
    fireEvent.click(screen.getByTestId('masked-toggle-taxId'))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('12-3456789')
    fireEvent.click(screen.getByTestId('masked-toggle-taxId'))
    expect(input).toHaveAttribute('type', 'password')
  })
})

describe('L5/J2: balance_groups_assets_liabilities_equity_in_order (10_06 01:09:04)', () => {
  const answers = {
    legalName: 'Boxes Co',
    engagementType: 'bookkeeping',
    checkingAccounts: [
      { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
    ],
    vehicleAssets: [
      { name: '2022 Ford Transit van', accountType: 'vehicle', proofCategory: 'bill_of_sale', year: 2022, financed: 'paid' },
    ],
    loanAccounts: [
      { name: 'Delivery van loan', accountType: 'loan', proofCategory: 'statement', lender: 'Ford Credit' },
    ],
    owners: [{ name: 'Wren Okafor' }, { name: 'Daniel Reyes' }],
    equitySetup: 'breakdown',
    equityBreakdown: ['contributions', 'distributions'],
    equityPerOwner: true,
  } as unknown as WizardAnswers

  it('the review nests the groups under Assets (current/long-term), Liabilities, Equity', () => {
    renderReview(answers)
    const boxes = screen.getAllByTestId(/^balance-box-(assets|liabilities|equity)$/)
    expect(boxes.map((b) => b.getAttribute('data-testid'))).toEqual([
      'balance-box-assets',
      'balance-box-liabilities',
      'balance-box-equity',
    ])

    // Assets split current (money accounts) from long-term (vehicles).
    const current = screen.getByTestId('balance-box-assets-current')
    expect(within(current).getByText(/Chase Checking/)).toBeInTheDocument()
    expect(within(current).queryByText(/Ford Transit/)).toBeNull()
    const longTerm = screen.getByTestId('balance-box-assets-long-term')
    expect(within(longTerm).getByText(/Ford Transit/)).toBeInTheDocument()

    // Liabilities hold the loan; nothing asset-side leaks in.
    const liabilities = screen.getByTestId('balance-box-liabilities')
    expect(within(liabilities).getByText(/Delivery van loan/)).toBeInTheDocument()
    expect(within(liabilities).queryByText(/Chase Checking/)).toBeNull()

    // Equity lists the planned per-owner breakdown (J3) - owner-major:
    // all of one owner's equity rows together.
    const equity = screen.getByTestId('balance-box-equity')
    const planRows = within(equity).getAllByTestId('equity-plan-row')
    expect(planRows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Owner Contributions - Wren Okafor'),
      expect.stringContaining('Owner Distributions - Wren Okafor'),
      expect.stringContaining('Owner Contributions - Daniel Reyes'),
      expect.stringContaining('Owner Distributions - Daniel Reyes'),
    ])
  })

  it('an unanswered equity setup still shows the Equity box with a prompt', () => {
    renderReview({
      legalName: 'No Equity Co',
      engagementType: 'bookkeeping',
      checkingAccounts: [
        { name: 'Chase Checking · 4411', accountType: 'checking', proofCategory: 'statement', institution: 'Chase', last4: '4411' },
      ],
    } as unknown as WizardAnswers)
    expect(screen.getByTestId('balance-box-equity')).toHaveTextContent('No equity setup yet')
  })
})

describe('L5/J3: equity questions gate on the setup pick and owner count', () => {
  it('breakdown + per-owner questions appear only when qualified', () => {
    const ids = (a: WizardAnswers) =>
      flattenScreens(a)
        .filter((s) => s.kind === 'question')
        .map((s) => s.questionId)
    const base = { engagementType: 'bookkeeping' } as WizardAnswers
    expect(ids(base)).toContain('equity-setup')
    expect(ids(base)).not.toContain('equity-breakdown')
    expect(ids(base)).not.toContain('equity-per-owner')

    const breakdown = { ...base, equitySetup: 'breakdown', owners: [{ name: 'A' }, { name: 'B' }] } as WizardAnswers
    expect(ids(breakdown)).toContain('equity-breakdown')
    expect(ids(breakdown)).toContain('equity-per-owner')

    const oneOwner = { ...base, equitySetup: 'breakdown', owners: [{ name: 'A' }] } as WizardAnswers
    expect(ids(oneOwner)).toContain('equity-breakdown')
    expect(ids(oneOwner)).not.toContain('equity-per-owner')
  })
})

describe('L5/J3: equity_breakdown_by_owner_when_multiple (10_06 01:10:10)', () => {
  it('unanswered keeps the §6.8 default (null plan)', () => {
    expect(equitySeedPlan({})).toBeNull()
  })

  it('grouped seeds one owner equity account; per-owner one per owner', () => {
    expect(equitySeedPlan({ equitySetup: 'grouped' })).toEqual([{ type: 'other_equity', name: "Owner's Equity" }])
    expect(
      equitySeedPlan({ equitySetup: 'grouped', equityPerOwner: true, owners: [{ name: 'Wren Okafor' }, { name: 'Daniel Reyes' }] }),
    ).toEqual([
      { type: 'other_equity', name: "Owner's Equity - Wren Okafor" },
      { type: 'other_equity', name: "Owner's Equity - Daniel Reyes" },
    ])
  })

  it('breakdown seeds the picks, multiplied per owner when asked', () => {
    expect(
      equitySeedPlan({
        equitySetup: 'breakdown',
        equityBreakdown: ['contributions', 'net_investment'],
        equityPerOwner: true,
        owners: [{ name: 'Wren Okafor' }, { name: 'Daniel Reyes' }],
      }),
    ).toEqual([
      { type: 'owner_contributions', name: 'Owner Contributions - Wren Okafor' },
      { type: 'other_equity', name: 'Net Investment Gain/Loss - Wren Okafor' },
      { type: 'owner_contributions', name: 'Owner Contributions - Daniel Reyes' },
      { type: 'other_equity', name: 'Net Investment Gain/Loss - Daniel Reyes' },
    ])
    // No per-owner: one row per pick, canonical labels.
    expect(equitySeedPlan({ equitySetup: 'breakdown', equityBreakdown: ['distributions'] })).toEqual([
      { type: 'owner_distributions', name: 'Owner Distributions' },
    ])
  })
})

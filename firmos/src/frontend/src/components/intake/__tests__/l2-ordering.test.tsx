import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'

import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen, ServicesScreen } from '../screens'

/**
 * L2 (B4, 10_06 00:21:42-00:24:06 + 00:34:12-00:34:52): the ordering rules.
 * Chronological for dates, alphabetical for names, the accounting equation
 * for financial lists - and "Included in every engagement" is the ONE
 * deliberate exception (it follows the A->B->C workflow sequence; Jason
 * confirmed "that one is fine").
 */

describe('L2/B4: ordering rules', () => {
  it('close tiers are chronological (5th, 10th, 15th)', () => {
    const q = findQuestion('reporting', 'close-tier')!
    expect(q.options?.map((o) => o.label)).toEqual(['By the 5th', 'By the 10th', 'By the 15th'])
  })

  it('"Included in every engagement" stays in workflow order (the alphabetization exception)', () => {
    const servicesQ = findQuestion('services', 'services')!
    const standards = servicesQ.services!.standards.map((s) => s.value)
    // A -> B -> C of the work: feeds, reconciliations, reporting. NOT alpha.
    expect(standards).toEqual(['bank_feed_management', 'account_reconciliations', 'reporting'])
  })

  it('the balance chapter follows the accounting equation: current assets, long-term assets, liabilities', () => {
    const balance = [
      'checking-accounts',
      'savings-accounts',
      'credit-cards',
      'vehicles',
      'other-assets',
      'loans',
    ]
    for (const id of balance) {
      expect(findQuestion('balance', id), id).toBeTruthy()
    }
  })

  it('from_your_answers_alphabetical (00:34:12): the services "From your answers" rows sort A-Z', () => {
    const servicesQ = findQuestion('services', 'services')!
    const answers: WizardAnswers = {
      engagementType: 'bookkeeping',
      serviceKeys: ['invoicing', 'class_tracking', 'payment_processing'],
    } as unknown as WizardAnswers
    render(
      <ServicesScreen
        q={servicesQ}
        values={answers.serviceKeys as string[]}
        answers={answers}
        onCommit={() => {}}
        onAdvance={() => {}}
      />,
    )
    const rows = [...screen.getByTestId('services-later-addons').querySelectorAll('[data-testid^="later-"]')].map(
      (el) => (el.textContent ?? '').replace('Added from your answers', '').trim(),
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows).toEqual([...rows].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())))
  })
})

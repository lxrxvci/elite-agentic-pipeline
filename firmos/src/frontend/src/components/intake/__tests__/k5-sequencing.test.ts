import { describe, expect, it } from 'vitest'

import { deriveRoutineTasks, type WizardAnswers } from '../registry'

/**
 * K5 (E4/E3, 09_30 00:52:56-00:54:51): Jason's default working order -
 * bank-throughput work before the bank reconciliation, questions after,
 * Send Reports last.
 */

const full: WizardAnswers = {
  legalName: 'X Co',
  engagementType: 'bookkeeping',
  quickbooksStatus: 'existing',
  bookkeepingFrequency: 'monthly',
  monthlyCloseTier: '10',
  bookkeepingStartDate: '2026-08-01',
  includeMerchantReconciliation: true,
  merchantAccounts: [{ name: 'Square' }],
  hasPayroll: true,
  payrollProvider: 'Gusto',
  payrollFrequency: 'biweekly',
  recordBills: true,
  payBills: true,
  depositsNonBusiness: true,
  personalOnBusiness: true,
  personalCardForBusiness: true,
  include1099Collection: true,
  customRecurringRules: [{ title: 'Weekly deposit review', scheduleType: 'weekly' }],
} as WizardAnswers

const keys = (a: WizardAnswers) => deriveRoutineTasks(a).map((t) => t.key)

describe('default task sequencing (E4/E3)', () => {
  it('bank_work_orders_before_reconciliation', () => {
    const order = keys(full)
    const before = [
      'categorize_transactions',
      'merchant-reconciliation',
      'payroll-handling',
      'record-bills',
      'pay-bills',
    ]
    const reconAt = order.indexOf('reconcile_accounts')
    expect(reconAt).toBeGreaterThan(-1)
    for (const k of before) {
      expect(order.indexOf(k)).toBeGreaterThan(-1)
      expect(order.indexOf(k)).toBeLessThan(reconAt)
    }
    // Questions + money-behavior reviews sit between recon and reports.
    expect(order.indexOf('client_questions')).toBeGreaterThan(reconAt)
    expect(order.indexOf('personal-on-business')).toBeGreaterThan(reconAt)
    expect(order.indexOf('deposits-non-business')).toBeGreaterThan(reconAt)
    expect(order.indexOf('personal-card')).toBeGreaterThan(reconAt)
    expect(order.indexOf('client_questions')).toBeGreaterThan(order.indexOf('personal-card'))
  })

  it('reports_always_last_in_bucket', () => {
    const order = keys(full)
    expect(order[order.length - 1]).toBe('send_reports')
    // Even with customs + 1099 present, reports close the sequence.
    expect(order.indexOf('custom:Weekly deposit review')).toBeLessThan(order.indexOf('send_reports'))
    expect(order.indexOf('1099-collection')).toBeLessThan(order.indexOf('send_reports'))
  })

  it('a minimal engagement keeps the four standards in working order', () => {
    const order = keys({
      legalName: 'Y Co',
      engagementType: 'bookkeeping',
      quickbooksStatus: 'none',
      bookkeepingFrequency: 'monthly',
      monthlyCloseTier: '15',
      bookkeepingStartDate: '2026-08-01',
    } as WizardAnswers)
    expect(order).toEqual([
      'categorize_transactions',
      'reconcile_accounts',
      'client_questions',
      'eoy-tax-checklist', // E9: every bookkeeping client
      'send_reports',
    ])
  })
})

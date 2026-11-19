import { describe, expect, it } from 'vitest'

import type { IntakeVendorAssignment } from '@/server/intake'
import { normalizePortalUrl } from '../portal-url'
import { vendorCustomRules, vendorRoutineTasks } from '../vendor-task-plan'

const assignment: IntakeVendorAssignment = {
  vendorId: 4,
  vendorName: 'Portland General Electric',
  frequency: 'monthly',
  paymentMethod: 'vendor_website',
  defaultPortalUrl: 'https://vendor.example.com/pay',
  sopTemplateId: 8,
}

describe('vendor setup', () => {
  it('creates record and payment work with cadence and a shared SOP link', () => {
    const tasks = vendorRoutineTasks([assignment], true, true, 15, 1)
    expect(tasks.map((task) => task.title)).toEqual(['Record bill: Portland General Electric', 'Pay bill: Portland General Electric'])
    expect(tasks.every((task) => task.sopTemplateId === 8)).toBe(true)
    expect(tasks.map((task) => task.defaultEntry.dayOfMonth)).toEqual([15, 15])
    expect(vendorCustomRules([assignment], true, true, 15, 1).map((rule) => rule.scheduleType)).toEqual(['monthly', 'monthly'])
  })

  it('keeps cash as the payment method through recurring work', () => {
    const tasks = vendorRoutineTasks([{ ...assignment, paymentMethod: 'cash' }], false, true, 15, 1)
    expect(tasks[0]?.detail).toBe('Monthly · Cash')
  })

  it('retains semi-annual cadence and never adds an AP ledger', () => {
    const rules = vendorCustomRules([{ ...assignment, frequency: 'semi_annual' }], true, true, 20, 7)
    expect(rules.every((rule) => rule.scheduleType === 'semi_annual' && rule.anchorMonth === 7 && rule.dayOfMonth === 20)).toBe(true)
  })
})

describe('portal URL safety', () => {
  it('accepts an ordinary HTTPS portal URL', () => {
    expect(normalizePortalUrl(' https://vendor.example.com/pay ')).toBe('https://vendor.example.com/pay')
  })

  it.each([
    'http://vendor.example.com/pay',
    'https://user:secret@vendor.example.com/pay',
    'https://vendor.example.com/pay?token=secret',
    'https://vendor.example.com/pay?password=secret',
    'not a URL',
  ])('rejects credentials or unsafe input: %s', (input) => {
    expect(() => normalizePortalUrl(input)).toThrow()
  })
})

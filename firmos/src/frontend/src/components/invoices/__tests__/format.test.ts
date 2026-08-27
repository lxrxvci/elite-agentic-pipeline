import { describe, expect, it } from 'vitest'

import {
  invoiceCsvFilename,
  invoiceStatusConfig,
  monthCsvFilename,
  parsePeriodParam,
  periodParam,
} from '../format'

describe('invoiceStatusConfig', () => {
  it('maps every invoice status to exactly one work-status token', () => {
    expect(invoiceStatusConfig('draft')).toEqual({ token: 'due_soon', label: 'Draft' })
    expect(invoiceStatusConfig('sent')).toEqual({ token: 'waiting_client', label: 'Sent' })
    expect(invoiceStatusConfig('paid')).toEqual({ token: 'on_track', label: 'Paid' })
    expect(invoiceStatusConfig('overdue')).toEqual({ token: 'overdue', label: 'Overdue' })
    expect(invoiceStatusConfig('void')).toEqual({ token: 'on_hold', label: 'Void' })
  })
})

describe('periodParam', () => {
  it('round-trips a year/month through the param format', () => {
    expect(periodParam(2026, 8)).toBe('2026-08')
    expect(periodParam(2026, 12)).toBe('2026-12')
    expect(parsePeriodParam('2026-08')).toEqual({ year: 2026, month: 8 })
  })

  it('rejects malformed periods', () => {
    expect(parsePeriodParam(undefined)).toBeNull()
    expect(parsePeriodParam('2026-13')).toBeNull()
    expect(parsePeriodParam('2026-00')).toBeNull()
    expect(parsePeriodParam('Aug 2026')).toBeNull()
    expect(parsePeriodParam('2026-8')).toBeNull()
  })
})

describe('CSV filenames', () => {
  it('names the monthly export invoices-YYYY-MM.csv', () => {
    expect(monthCsvFilename(2026, 8)).toBe('invoices-2026-08.csv')
    expect(monthCsvFilename(2026, 11)).toBe('invoices-2026-11.csv')
  })

  it('names a single-invoice export after the invoice number', () => {
    expect(invoiceCsvFilename('INV-202608-2258', 12)).toBe('invoice-INV-202608-2258.csv')
    expect(invoiceCsvFilename('', 12)).toBe('invoice-INV-12.csv')
  })
})

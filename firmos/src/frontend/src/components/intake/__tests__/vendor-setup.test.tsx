import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { IntakeVendorAssignment } from '@/server/intake'
import type { VendorCatalogRow } from '@/server/vendors'
import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

const vendor: VendorCatalogRow = {
  id: 1,
  name: 'Portland General Electric',
  defaultPortalUrl: 'https://vendor.example.com/pay',
  sopTemplateId: 3,
  reusable: true,
}

function Harness({ payment = false, onAdvance = () => {}, onDefaults = async () => vendor }: {
  payment?: boolean
  onAdvance?: () => void
  onDefaults?: (id: number, input: { defaultPortalUrl?: string | null }) => Promise<VendorCatalogRow>
}) {
  const q = findQuestion('reporting', payment ? 'pay-bills' : 'record-bills')!
  const [answers, setAnswers] = useState<WizardAnswers>({
    recordBills: true,
    payBills: payment,
    vendorAssignments: payment ? [{
      vendorId: vendor.id,
      vendorName: vendor.name,
      frequency: 'monthly',
      defaultPortalUrl: vendor.defaultPortalUrl,
      sopTemplateId: vendor.sopTemplateId,
    }] : [],
  })
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        intakeId={7}
        vendorCatalog={[vendor, { id: 4, name: 'Vendor Without SOP', defaultPortalUrl: null, sopTemplateId: null, reusable: true }]}
        sopTemplates={[{ id: 3, title: 'Shared utility procedure' }]}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={onAdvance}
        onPickOption={(value) => setAnswers((current) => ({ ...current, ...q.apply(current, value) }))}
        onAddVendor={async (name, input) => ({
          id: 2,
          name,
          defaultPortalUrl: null,
          sopTemplateId: null,
          reusable: input.reusable !== false,
        })}
        onRenameVendor={async () => vendor}
        onVendorDefaults={onDefaults}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

describe('vendor and payment setup', () => {
  it('uses both vendor selectors and the three shared SOP choices', async () => {
    const onAdvance = vi.fn()
    render(<Harness onAdvance={onAdvance} />)
    expect(screen.queryByText('Offer new vendors to every client')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Vendors' }))
    expect(screen.queryByRole('option', { name: 'Vendor Without SOP' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: vendor.name }))
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Vendors' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('combobox', { name: `Frequency for ${vendor.name}` }))
    fireEvent.click(screen.getByRole('option', { name: 'Quarterly' }))
    expect(screen.getByRole('combobox', { name: `SOP for ${vendor.name}` })).toHaveValue('Use existing SOP')
    expect(screen.getByRole('combobox', { name: `Existing SOP for SOP for ${vendor.name}` })).toHaveValue('Shared utility procedure')
    fireEvent.click(screen.getByTestId('all-vendors-input'))
    fireEvent.click(screen.getByRole('option', { name: 'Vendor Without SOP' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'SOP for Vendor Without SOP' }))
    fireEvent.click(screen.getByRole('option', { name: 'I’m not sure' }))
    fireEvent.click(screen.getByTestId('vendor-input'))
    fireEvent.click(screen.getByTestId('vendor-add-toggle'))
    fireEvent.change(screen.getByLabelText('New option name'), { target: { value: 'Shared repair vendor' } })
    fireEvent.click(screen.getByTestId('vendor-add-submit'))
    await screen.findByRole('heading', { name: 'Shared repair vendor' })
    fireEvent.click(screen.getByRole('combobox', { name: 'SOP for Shared repair vendor' }))
    fireEvent.click(screen.getByRole('option', { name: 'Create new SOP' }))
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers.vendorAssignments).toHaveLength(3)
    expect(answers.vendorAssignments?.[0]).toMatchObject({ vendorId: 1, frequency: 'quarterly', sopTemplateId: 3, sopStatus: 'existing' })
    expect(answers.vendorAssignments?.[1]).toMatchObject({ vendorId: 4, sopStatus: 'unsure' })
    expect(answers.vendorAssignments?.[2]).toMatchObject({ vendorName: 'Shared repair vendor', frequency: 'monthly', sopStatus: 'create' })
  })

  it('uses selected vendors for payment setup and saves a shared portal default', async () => {
    const onAdvance = vi.fn()
    const onDefaults = vi.fn(async (_id: number, input: { defaultPortalUrl?: string | null }) => ({
      ...vendor,
      defaultPortalUrl: input.defaultPortalUrl ?? null,
    }))
    render(<Harness payment onAdvance={onAdvance} onDefaults={onDefaults} />)
    fireEvent.click(screen.getByRole('combobox', { name: `Payment method for ${vendor.name}` }))
    fireEvent.click(screen.getByRole('option', { name: 'Vendor portal' }))
    const portal = screen.getByLabelText('Payment portal URL (optional)')
    fireEvent.change(portal, { target: { value: 'https://vendor.example.com/pay' } })
    fireEvent.blur(portal)
    fireEvent.click(screen.getByTestId('save-vendor-default-1'))
    await waitFor(() => expect(onDefaults).toHaveBeenCalledWith(1, { defaultPortalUrl: 'https://vendor.example.com/pay' }))
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers.vendorAssignments?.[0]).toMatchObject({ paymentMethod: 'vendor_website', portalUrl: null })
    await waitFor(() => expect(screen.getByTestId('continue')).toBeEnabled())
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('selects cash with the shared searchable selector', () => {
    const onAdvance = vi.fn()
    render(<Harness payment onAdvance={onAdvance} />)
    const picker = screen.getByRole('combobox', { name: `Payment method for ${vendor.name}` })
    fireEvent.click(picker)
    fireEvent.change(picker, { target: { value: 'Cash' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    const answers = JSON.parse(screen.getByTestId('answers').textContent!) as WizardAnswers
    expect(answers.vendorAssignments?.[0]).toMatchObject({ paymentMethod: 'cash' })
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('blocks a URL containing credentials', () => {
    const onAdvance = vi.fn()
    render(<Harness payment onAdvance={onAdvance} />)
    fireEvent.click(screen.getByRole('combobox', { name: `Payment method for ${vendor.name}` }))
    fireEvent.click(screen.getByRole('option', { name: 'Vendor portal' }))
    const portal = screen.getByLabelText('Payment portal URL (optional)')
    fireEvent.change(portal, { target: { value: 'https://vendor.example.com/pay?token=secret' } })
    fireEvent.blur(portal)
    expect(screen.getByRole('alert')).toHaveTextContent('Keep credentials out of the portal URL')
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
  })
})

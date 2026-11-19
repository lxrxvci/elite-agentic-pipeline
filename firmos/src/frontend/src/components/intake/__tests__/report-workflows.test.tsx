import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ReportCatalogRow } from '@/server/reports-catalog'
import { findQuestion, type WizardAnswers } from '../registry'
import { QuestionScreen } from '../screens'

const catalog: ReportCatalogRow[] = [
  { id: 1, name: 'Common board packet', isCommon: true, sopTemplateId: 5 },
  { id: 2, name: 'Client-only report', isCommon: false, sopTemplateId: null },
]

function Reports({ onAdvance = () => {}, onAdd = vi.fn(async (name: string, isCommon: boolean, sopTemplateId: number | null): Promise<ReportCatalogRow> => ({
  id: catalog.find((row) => row.name === name)?.id ?? 99, name, isCommon, sopTemplateId,
})) }: {
  onAdvance?: () => void
  onAdd?: (name: string, isCommon: boolean, sopTemplateId: number | null) => Promise<ReportCatalogRow>
}) {
  const q = findQuestion('reporting', 'reports')!
  const [answers, setAnswers] = useState<WizardAnswers>({})
  return (
    <>
      <QuestionScreen
        q={q}
        answers={answers}
        intakeId={7}
        reportCatalog={catalog}
        sopTemplates={[{ id: 5, title: 'Shared report procedure' }]}
        onAddReportType={onAdd}
        onRenameReportType={async (id, name) => ({ id, name, isCommon: true, sopTemplateId: 5 })}
        onApply={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
        onAdvance={onAdvance}
        onPickOption={() => {}}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  )
}

function answersNow(): WizardAnswers {
  return JSON.parse(screen.getByTestId('answers').textContent!)
}

describe('year-end and specialty reports', () => {
  it('uses one 1099 choice and an optional estimate, with no selected by default for legacy answers', () => {
    const q = findQuestion('reporting', 'ten99-services')!
    expect(q.type).toBe('select')
    expect(q.get({ serviceKeys: [] })).toBe('no')
    expect(q.apply({ serviceKeys: ['1099_collection', '1099_full_management'] }, '1099_full_management')).toMatchObject({
      include1099Collection: false,
      include1099FullManagement: true,
      serviceKeys: ['1099_full_management'],
    })
    expect(q.apply({ estimated1099Count: 8, serviceKeys: ['1099_collection'] }, 'no').estimated1099Count).toBeNull()
    expect(q.inlineFollowup?.question.required).toBe(false)
    expect(q.inlineFollowup?.question.fields?.[0]).toMatchObject({ key: 'estimated1099Count', kind: 'number' })
    expect(q.summarize({ include1099FullManagement: true, estimated1099Count: 8 })).toBe('1099 full management · ~8 filings')
  })

  it('selects a common report with its SOP and independent client frequency', async () => {
    render(<Reports />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Report name' }))
    fireEvent.click(screen.getByRole('option', { name: 'Common board packet' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    fireEvent.click(screen.getByRole('option', { name: 'Annual' }))
    expect(screen.getByRole('combobox', { name: 'SOP' })).toHaveValue('Use existing SOP')
    expect(screen.getByRole('combobox', { name: 'Existing SOP for SOP' })).toHaveValue('Shared report procedure')
    fireEvent.click(screen.getByTestId('add-another'))
    await waitFor(() => expect(answersNow().reportDefinitions).toHaveLength(1))
    expect(answersNow().reportDefinitions?.[0]).toMatchObject({
      catalogId: 1,
      name: 'Common board packet',
      frequency: 'annual',
      isCommon: true,
      sopTemplateId: 5,
    })
  })

  it('adds a unique report, asks whether it is common, and awaits catalog persistence', async () => {
    const onAdd = vi.fn(async (name: string, isCommon: boolean, sopTemplateId: number | null): Promise<ReportCatalogRow> => ({
      id: 99, name, isCommon, sopTemplateId,
    }))
    render(<Reports onAdd={onAdd} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Report name' }), { target: { value: 'Custom county report' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    fireEvent.click(screen.getByRole('option', { name: 'Quarterly' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'SOP' }))
    fireEvent.click(screen.getByRole('option', { name: 'Use existing SOP' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Existing SOP for SOP' }))
    fireEvent.click(screen.getByRole('option', { name: 'Shared report procedure' }))
    fireEvent.click(screen.getByLabelText('Is this common?'))
    fireEvent.click(screen.getByTestId('add-another'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Custom county report', true, 5))
    expect(answersNow().reportDefinitions?.[0]).toMatchObject({
      catalogId: 99,
      frequency: 'quarterly',
      isCommon: true,
      sopTemplateId: 5,
    })
  })

  it('prompts before continuing with an unsaved edit and persists it on save', async () => {
    const onAdvance = vi.fn()
    render(<Reports onAdvance={onAdvance} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Report name' }))
    fireEvent.click(screen.getByRole('option', { name: 'Common board packet' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequency' }))
    fireEvent.click(screen.getByRole('option', { name: 'Monthly' }))
    fireEvent.click(screen.getByTestId('add-another'))
    await screen.findByTestId('entity-chip')
    fireEvent.click(screen.getByTestId('entity-edit-0'))
    fireEvent.click(within(screen.getByTestId('entity-edit-form-0')).getByRole('combobox', { name: 'Frequency' }))
    fireEvent.click(screen.getByRole('option', { name: 'Annual' }))
    fireEvent.click(screen.getByTestId('continue'))
    expect(onAdvance).not.toHaveBeenCalled()
    expect(screen.getByTestId('unsaved-draft-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('unsaved-draft-save'))
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1))
    expect(answersNow().reportDefinitions?.[0].frequency).toBe('annual')
  })
})

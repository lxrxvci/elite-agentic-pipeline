'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/ui/native-select'
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select'
import type { IntakeMerchantAccountInput } from '@/server/intake'
import type { MerchantProcessorRow } from '@/server/merchant-processors'
import { normalizeInstitutionKey } from '@/shared/lib/institution-key'

import { CardNavigation } from './navigation'
import type { QuestionDef, WizardAnswers } from './registry'

export function ProcessorStackScreen({
  q,
  answers,
  processors,
  onAddProcessor,
  onApply,
  onAdvance,
  showNavigation = true,
}: {
  q: QuestionDef
  answers: WizardAnswers
  processors: MerchantProcessorRow[]
  onAddProcessor?: (name: string) => Promise<MerchantProcessorRow | null>
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
  showNavigation?: boolean
}) {
  const items = (q.get(answers) as IntakeMerchantAccountInput[] | undefined) ?? []
  const [rows, setRows] = useState(() => [...processors].sort((a, b) => a.name.localeCompare(b.name)))
  const [error, setError] = useState<string | null>(null)

  const fold = (value: string | null | undefined) => normalizeInstitutionKey(value) ?? ''
  const selectedIds = new Set(items.map((item) => item.processorId).filter((id): id is number => typeof id === 'number'))
  const selectedNames = new Set(items.map((item) => fold(item.processor ?? item.name)))
  const isSelected = (row: MerchantProcessorRow) => selectedIds.has(row.id) || selectedNames.has(fold(row.name))
  const selectedValues = rows.filter(isSelected).map((row) => String(row.id))
  const commit = (next: IntakeMerchantAccountInput[]) => onApply(q.apply(answers, next))
  const accountFor = (row: MerchantProcessorRow): IntakeMerchantAccountInput => ({
    name: row.name,
    processor: row.name,
    processorId: row.id,
  })

  const changeSelection = (nextIds: string[]) => {
    setError(null)
    const selectedRows = rows.filter((row) => nextIds.includes(String(row.id))).map(accountFor)
    const legacyRows = items.filter(
      (item) =>
        item.processorId == null &&
        !rows.some((row) => fold(row.name) === fold(item.processor ?? item.name)),
    )
    commit([...legacyRows, ...selectedRows])
  }

  const addProcessor = async (name: string) => {
    if (!onAddProcessor) throw new Error('Could not add the processor - try again.')
    const row = await onAddProcessor(name)
    if (!row) throw new Error('Could not add the processor - try again.')
    setRows((current) => {
      const next = current.some((item) => item.id === row.id)
        ? current.map((item) => (item.id === row.id ? row : item))
        : [...current, row]
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    if (!isSelected(row)) commit([...items, accountFor(row)])
  }

  const renameProcessor = async (option: SearchSelectOption<MerchantProcessorRow>, name: string) => {
    const row = option.data
    if (name === row.name) return
    const { renameMerchantProcessorAction } = await import('@/server/actions/merchant-processors')
    const result = await renameMerchantProcessorAction(row.id, name)
    if (!result.ok) throw new Error(result.error)
    option.data.name = result.data.name
    setRows((current) =>
      current
        .map((item) => (item.id === row.id ? { ...item, name: result.data.name } : item))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    if (selectedIds.has(row.id)) {
      commit(
        items.map((item) =>
          item.processorId === row.id
            ? { ...item, name: result.data.name, processor: result.data.name }
            : item,
        ),
      )
    }
    toast.success(`Renamed to "${result.data.name}".`)
  }

  const finish = () => {
    if (q.required && items.length === 0) {
      setError('Pick at least one processor, or go back.')
      return
    }
    if (q.merchantReconcile && items.length > 0 && answers.includeMerchantReconciliation == null) {
      setError('Choose whether we should reconcile the merchant accounts.')
      return
    }
    setError(null)
    onAdvance()
  }

  return (
    <div className="space-y-4">
      {q.merchantReconcile && (
        <label className="block text-sm font-medium text-foreground">
          Should we reconcile the merchant accounts?
          <NativeSelect
            data-testid="merchant-reconcile"
            className="mt-1.5"
            value={answers.includeMerchantReconciliation === true ? 'yes' : answers.includeMerchantReconciliation === false ? 'no' : ''}
            onChange={(event) => {
              setError(null)
              onApply({ includeMerchantReconciliation: event.target.value === 'yes' })
            }}
          >
            <option value="">Choose an answer…</option>
            <option value="yes">Yes - reconcile these accounts</option>
            <option value="no">No - only track the processors</option>
          </NativeSelect>
        </label>
      )}

      <SearchSelect
        multiple
        ariaLabel="Merchant processors"
        options={rows.map((row) => ({ id: String(row.id), label: row.name, testid: row.name, data: row }))}
        values={selectedValues}
        onChange={changeSelection}
        onAdd={addProcessor}
        onRename={renameProcessor}
        addLabel={(query) => (query ? `Add "${query}" as a new processor` : 'Add processor…')}
        placeholder="Search or select processors…"
        emptyMessage="No processors match."
        testidPrefix="processor"
      />

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      {showNavigation && (
        <CardNavigation onClick={finish} data-testid="continue">
          Continue
        </CardNavigation>
      )}
    </div>
  )
}

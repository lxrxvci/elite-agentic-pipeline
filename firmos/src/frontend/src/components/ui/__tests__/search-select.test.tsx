import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adaptiveVisibleRowCount, SearchSelect, type SearchSelectOption } from '../search-select'

beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

type Row = { id: number; name: string }
const rows: Row[] = [
  { id: 2, name: 'Gusto' },
  { id: 1, name: 'ADP' },
  { id: 3, name: 'QuickBooks Payroll' },
]
const options: SearchSelectOption<Row>[] = rows.map((row) => ({ id: String(row.id), label: row.name, data: row }))

function SingleHarness({ onAdd }: { onAdd?: (name: string) => Promise<void> }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <SearchSelect
      ariaLabel="Payroll provider"
      options={options}
      value={value}
      onChange={setValue}
      onAdd={onAdd}
      inputTestid="provider-select-0"
      testidPrefix="provider"
    />
  )
}

describe('SearchSelect', () => {
  it('implements Jason’s adaptive row counts', () => {
    expect([0, 1, 10, 11, 20, 21, 30, 100, 101, 110, 111, 500].map(adaptiveVisibleRowCount)).toEqual([
      0, 1, 10, 10, 10, 11, 11, 18, 19, 19, 20, 20,
    ])
  })

  it('opens an alphabetized list, filters as text changes, and keeps single-select closed after selection', async () => {
    render(<SingleHarness />)
    const input = screen.getByTestId('provider-select-0')
    fireEvent.click(input)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'ADP',
      'Gusto',
      'QuickBooks Payroll',
    ])
    fireEvent.change(input, { target: { value: 'gus' } })
    expect(screen.getByTestId('provider-option-2')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-option-1')).toBeNull()
    fireEvent.click(screen.getByTestId('provider-option-2'))
    expect(input).toHaveValue('Gusto')
    await waitFor(() => expect(screen.queryByTestId('provider-listbox')).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('provider-listbox')).toBeNull()
  })

  it('preserves numeric source order and pins special choices around alphabetical catalogs', () => {
    const days = Array.from({ length: 31 }, (_, index) => String(index + 1))
    const onChange = vi.fn()
    const { unmount } = render(
      <SearchSelect
        ariaLabel="Period start"
        optionOrder="source"
        options={days.map((day) => ({ id: day, label: day, data: day }))}
        value={null}
        onChange={onChange}
      />,
    )
    const dayInput = screen.getByRole('combobox', { name: 'Period start' })
    fireEvent.click(dayInput)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(days)
    fireEvent.keyDown(dayInput, { key: 'ArrowDown' })
    fireEvent.keyDown(dayInput, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('2', expect.objectContaining({ id: '2' }))
    unmount()

    render(
      <SearchSelect
        ariaLabel="Catalog"
        options={[
          { id: 'z', label: 'Zulu', data: 'z' },
          { id: 'other', label: 'Other', pin: 'last', data: 'other' },
          { id: 'a', label: 'Alpha', data: 'a' },
          { id: '', label: 'All choices', pin: 'first', data: '' },
        ]}
        value={null}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Catalog' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All choices',
      'Alpha',
      'Zulu',
      'Other',
    ])
  })

  it('keeps multi-select open with independent checked state', () => {
    function MultiHarness() {
      const [values, setValues] = useState<string[]>([])
      return (
        <SearchSelect
          multiple
          ariaLabel="Merchant processors"
          options={options}
          values={values}
          onChange={setValues}
          testidPrefix="processor"
        />
      )
    }
    render(<MultiHarness />)
    fireEvent.click(screen.getByTestId('processor-input'))
    const option = screen.getByTestId('processor-option-2')
    fireEvent.click(option)
    expect(option).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('processor-selected-list')).toHaveTextContent('Gusto')
    expect(screen.getByTestId('processor-selected-list').tagName).toBe('UL')
    fireEvent.keyDown(screen.getByTestId('processor-input'), { key: 'Escape' })
    expect(screen.getByTestId('processor-input')).toHaveValue('')
    fireEvent.click(screen.getByTestId('processor-input'))
    const reopenedOption = screen.getByTestId('processor-option-2')
    fireEvent.click(reopenedOption)
    expect(reopenedOption).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('processor-selected-list')).toBeNull()
  })

  it('persists an inline addition and selects it', async () => {
    const onAdd = vi.fn(async () => {})
    render(<SingleHarness onAdd={onAdd} />)
    fireEvent.click(screen.getByTestId('provider-select-0'))
    fireEvent.click(screen.getByTestId('provider-add-toggle'))
    fireEvent.change(screen.getByTestId('provider-add-input'), { target: { value: 'SurePayroll' } })
    fireEvent.click(screen.getByTestId('provider-add-submit'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('SurePayroll'))
    await waitFor(() => expect(screen.queryByTestId('provider-listbox')).toBeNull())
  })

  it('renames through the pencil workflow without a selection change', async () => {
    const onRename = vi.fn(async () => {})
    render(
      <SearchSelect
        multiple
        ariaLabel="Merchant processors"
        options={options}
        values={[]}
        onChange={() => {}}
        onRename={onRename}
        testidPrefix="processor"
      />,
    )
    fireEvent.click(screen.getByTestId('processor-input'))
    expect(screen.getByTestId('processor-listbox').querySelector('button')).toBeNull()
    fireEvent.click(screen.getByTestId('processor-edit-2'))
    fireEvent.change(screen.getByLabelText('Rename Gusto'), { target: { value: 'Gusto Payroll' } })
    fireEvent.click(screen.getByTestId('processor-rename-save-2'))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(options[0], 'Gusto Payroll'))
    expect(screen.queryByLabelText('Rename Gusto')).toBeNull()
  })

  it('emits browse and typed async queries', async () => {
    const onSearch = vi.fn()
    render(
      <SearchSelect
        ariaLabel="Existing contacts"
        options={options}
        value={null}
        onChange={() => {}}
        onSearch={onSearch}
        testidPrefix="contact-picker"
      />,
    )
    const input = screen.getByTestId('contact-picker-input')
    fireEvent.click(input)
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(''))
    fireEvent.change(input, { target: { value: 'sal' } })
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('sal'))
  })

  it('supports keyboard selection and exposes the adaptive row count', () => {
    const many = Array.from({ length: 21 }, (_, index) => ({
      id: String(index + 1),
      label: `Option ${String(index + 1).padStart(2, '0')}`,
      data: null,
    }))
    function LongHarness() {
      const [value, setValue] = useState<string | null>(null)
      return <SearchSelect ariaLabel="Long list" options={many} value={value} onChange={setValue} testidPrefix="long" />
    }
    render(<LongHarness />)
    const input = screen.getByTestId('long-input')
    fireEvent.click(input)
    expect(screen.getByTestId('long-listbox')).toHaveAttribute('data-visible-rows', '11')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Option 02')
    expect(screen.queryByTestId('long-listbox')).toBeNull()
  })

  it.each([150, 500, 2000])('filters %i options with the pencil enabled and no per-option queries', (count) => {
    const many = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      label: `Option ${String(index + 1).padStart(4, '0')}`,
      data: null,
    }))
    const onSearch = vi.fn()
    const onRename = vi.fn(async () => {})
    render(
      <SearchSelect
        multiple
        ariaLabel="Performance list"
        options={many}
        values={[]}
        onChange={() => {}}
        onSearch={onSearch}
        onRename={onRename}
        testidPrefix="performance"
      />,
    )
    const input = screen.getByTestId('performance-input')
    fireEvent.click(input)
    const target = `Option ${String(count).padStart(4, '0')}`
    fireEvent.change(input, { target: { value: target } })
    expect(screen.getByTestId(`performance-option-${count}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`performance-option-${count - 1}`)).toBeNull()
    expect(onRename).not.toHaveBeenCalled()
    expect(onSearch).toHaveBeenCalledTimes(2)
  })
})

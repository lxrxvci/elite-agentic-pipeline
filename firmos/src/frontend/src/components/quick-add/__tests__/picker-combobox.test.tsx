import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { PickerCombobox } from '../picker-combobox'

describe('PickerCombobox', () => {
  it('supports selecting two different pickers in sequence', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [client, setClient] = useState<number | null>(null)
      const [assignee, setAssignee] = useState<number | null>(null)
      return (
        <div>
          <PickerCombobox
            id="client"
            label="Client"
            options={[{ id: 1, label: 'Harborline Marine Supply' }]}
            value={client}
            onChange={setClient}
            placeholder="Pick a client"
          />
          <PickerCombobox
            id="assignee"
            label="Assignee"
            options={[{ id: 10, label: 'Dana Whitfield', hint: 'manager' }]}
            value={assignee}
            onChange={setAssignee}
            placeholder="Pick a person"
            noneLabel="Unassigned"
          />
          <span data-testid="values">{client}:{assignee}</span>
        </div>
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole('combobox', { name: 'Client' }))
    await user.click(await screen.findByRole('option', { name: 'Harborline Marine Supply' }))
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(await screen.findByRole('option', { name: 'Dana Whitfield' }))
    expect(screen.getByTestId('values')).toHaveTextContent('1:10')
  })
})

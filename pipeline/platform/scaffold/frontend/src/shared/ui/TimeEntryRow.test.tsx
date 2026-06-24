import { describe, expect, it } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'
import { TimeEntryRow } from './TimeEntryRow'

describe('TimeEntryRow', () => {
  it('renders description and rounded duration', () => {
    render(
      <TimeEntryRow
        description="Design"
        durationMinutes={60}
        roundedMinutes={60}
        status="unbilled"
        clientName="Acme"
        projectName="Website"
      />
    )
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByText('Acme · Website')).toBeInTheDocument()
    expect(screen.getByText('1h')).toBeInTheDocument()
  })

  it('shows tracked duration when rounded differs', () => {
    render(
      <TimeEntryRow
        description="Dev"
        durationMinutes={55}
        roundedMinutes={60}
        status="billed"
      />
    )
    expect(screen.getByText('55m tracked')).toBeInTheDocument()
  })
})

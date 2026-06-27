import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterAll } from 'vitest'
import { trackError } from '@/shared/lib/telemetry'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('@/shared/lib/telemetry', () => ({
  trackError: vi.fn(),
}))

const Thrower = ({ message }: { message: string }) => {
  throw new Error(message)
}

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

describe('ErrorBoundary', () => {
  afterAll(() => {
    consoleError.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('ok')).toBeInTheDocument()
  })

  it('renders fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Thrower message="boom" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalled()
    expect(trackError).toHaveBeenCalledWith(expect.any(Error), expect.any(Object))
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom">custom error</div>}>
        <Thrower message="boom" />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('custom')).toBeInTheDocument()
  })
})

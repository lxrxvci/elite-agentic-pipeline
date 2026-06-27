'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { trackError } from '@/shared/lib/telemetry'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, errorInfo)
    trackError(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex min-h-screen items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-elite-border bg-elite-white p-6 shadow-card">
              <h1 className="text-xl font-bold text-elite-text-primary">Something went wrong</h1>
              <p className="mt-2 text-sm text-elite-text-secondary">
                An unexpected error occurred. Please refresh the page or try again later.
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <pre className="mt-4 max-h-40 overflow-auto rounded bg-elite-surface p-3 text-xs text-elite-danger">
                  {this.state.error.message}
                </pre>
              )}
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}

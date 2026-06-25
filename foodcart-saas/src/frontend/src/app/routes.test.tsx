import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/shared/lib/test-utils'

vi.mock('@/features/auth/ui/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/page-views/clients', () => ({ default: () => <div data-testid="clients-view" /> }))
vi.mock('@/page-views/clients-new', () => ({ default: () => <div data-testid="clients-new-view" /> }))
vi.mock('@/page-views/projects', () => ({ default: () => <div data-testid="projects-view" /> }))
vi.mock('@/page-views/projects-new', () => ({ default: () => <div data-testid="projects-new-view" /> }))
vi.mock('@/page-views/invoices', () => ({ default: () => <div data-testid="invoices-view" /> }))
vi.mock('@/page-views/invoices-new', () => ({ default: () => <div data-testid="invoices-new-view" /> }))
vi.mock('@/page-views/invoice-detail', () => ({ default: () => <div data-testid="invoice-detail-view" /> }))
vi.mock('@/page-views/time-tracker', () => ({ default: () => <div data-testid="time-tracker-view" /> }))
vi.mock('@/page-views/login', () => ({ default: () => <div data-testid="login-view" /> }))
vi.mock('@/page-views/dashboard', () => ({ DashboardPage: () => <div data-testid="dashboard-view" /> }))

import ClientsRoute from './clients/page'
import NewClientRoute from './clients/new/page'
import ProjectsRoute from './projects/page'
import NewProjectRoute from './projects/new/page'
import InvoicesRoute from './invoices/page'
import NewInvoiceRoute from './invoices/new/page'
import InvoiceDetailRoute from './invoices/[id]/page'
import TimeTrackerRoute from './time-tracker/page'
import LoginRoute from './login/page'
import HomeRoute from './page'

describe('app routes', () => {
  it.each([
    ['/', HomeRoute, 'dashboard-view'],
    ['/clients', ClientsRoute, 'clients-view'],
    ['/clients/new', NewClientRoute, 'clients-new-view'],
    ['/projects', ProjectsRoute, 'projects-view'],
    ['/projects/new', NewProjectRoute, 'projects-new-view'],
    ['/invoices', InvoicesRoute, 'invoices-view'],
    ['/invoices/new', NewInvoiceRoute, 'invoices-new-view'],
    ['/invoices/1', InvoiceDetailRoute, 'invoice-detail-view'],
    ['/time-tracker', TimeTrackerRoute, 'time-tracker-view'],
    ['/login', LoginRoute, 'login-view'],
  ])('renders %s route', async (_path, Route, testId) => {
    render(<Route />)
    expect(await screen.findByTestId(testId)).toBeInTheDocument()
  })
})

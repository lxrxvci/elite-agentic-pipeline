import { test, expect } from '@playwright/test'

const API_BASE_URL = 'http://localhost:8000/api/v1'
const API_BASE_PATH = '/api/v1'

interface Client {
  id: string
  tenant_id: string
  name: string
  email: string | null
  currency: string
  default_hourly_rate: string | null
  created_at: string
  updated_at: string
}

interface Project {
  id: string
  tenant_id: string
  client_id: string
  name: string
  rounding_minutes: number
  created_at: string
  updated_at: string
}

type TimeEntryStatus = 'unbilled' | 'billed' | 'written_off'

interface TimeEntry {
  id: string
  tenant_id: string
  client_id: string
  project_id: string
  invoice_id: string | null
  description: string
  duration_minutes: number
  rounded_minutes: number
  status: TimeEntryStatus
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
}

interface Money {
  amount: string
  currency: string
}

interface InvoiceLineItem {
  id: string
  description: string
  quantity: string
  rate: string
  amount: Money
  time_entry_ids: string[]
}

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

interface Invoice {
  id: string
  tenant_id: string
  client_id: string
  status: InvoiceStatus
  issue_date: string
  due_date: string
  notes: string | null
  subtotal: Money
  tax: Money
  total: Money
  idempotency_key: string | null
  line_items: InvoiceLineItem[]
  created_at: string
  updated_at: string
}

interface Store {
  user: { id: string; email: string; name: string }
  clients: Client[]
  projects: Project[]
  entries: TimeEntry[]
  invoices: Invoice[]
}

function now() {
  return new Date().toISOString()
}

function paginated<T>(items: T[]) {
  return { items, total: items.length }
}

function roundMinutes(minutes: number, rounding: number) {
  return Math.max(rounding, Math.round(minutes / rounding) * rounding)
}

test.describe('full user journey', () => {
  test.beforeEach(async ({ page }) => {
    const store: Store = {
      user: { id: 'user-journey', email: 'journey@example.com', name: 'Journey User' },
      clients: [],
      projects: [],
      entries: [],
      invoices: [],
    }

    let clientSeq = 0
    let projectSeq = 0
    let entrySeq = 0
    let invoiceSeq = 0

    await page.route(
      new RegExp('^' + API_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/.*$'),
      async (route, request) => {
        const url = new URL(request.url())
        const endpoint = url.pathname.replace(API_BASE_PATH, '') || '/'
        const method = request.method()

        if (method === 'GET' && endpoint === '/me') {
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(store.user),
          })
        }

        if (method === 'POST' && endpoint === '/auth/token') {
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: 'journey-token', token_type: 'bearer' }),
          })
        }

        if (method === 'POST' && endpoint === '/auth/logout') {
          return route.fulfill({ status: 204 })
        }

        if (method === 'GET' && endpoint === '/clients') {
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paginated(store.clients)),
          })
        }

        if (method === 'POST' && endpoint === '/clients') {
          const body = request.postDataJSON() as Partial<ClientCreate>
          clientSeq += 1
          const client: Client = {
            id: `client-${clientSeq}`,
            tenant_id: 'tenant-journey',
            name: body.name ?? '',
            email: body.email ?? null,
            currency: body.currency ?? 'USD',
            default_hourly_rate: body.default_hourly_rate ?? null,
            created_at: now(),
            updated_at: now(),
          }
          store.clients.push(client)
          return route.fulfill({
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(client),
          })
        }

        if (method === 'GET' && endpoint === '/projects') {
          const clientId = url.searchParams.get('client_id')
          const items = clientId
            ? store.projects.filter((p) => p.client_id === clientId)
            : store.projects
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paginated(items)),
          })
        }

        if (method === 'POST' && endpoint === '/projects') {
          const body = request.postDataJSON() as Partial<ProjectCreate>
          projectSeq += 1
          const project: Project = {
            id: `project-${projectSeq}`,
            tenant_id: 'tenant-journey',
            client_id: body.client_id ?? '',
            name: body.name ?? '',
            rounding_minutes: body.rounding_minutes ?? 15,
            created_at: now(),
            updated_at: now(),
          }
          store.projects.push(project)
          return route.fulfill({
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(project),
          })
        }

        if (method === 'GET' && endpoint === '/time-entries') {
          const status = url.searchParams.get('status') as TimeEntryStatus | null
          const clientId = url.searchParams.get('client_id')
          const projectId = url.searchParams.get('project_id')
          let items = store.entries
          if (status) items = items.filter((e) => e.status === status)
          if (clientId) items = items.filter((e) => e.client_id === clientId)
          if (projectId) items = items.filter((e) => e.project_id === projectId)
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paginated(items)),
          })
        }

        if (method === 'POST' && endpoint === '/time-entries') {
          const body = request.postDataJSON() as Partial<TimeEntryCreate>
          entrySeq += 1
          const project = store.projects.find((p) => p.id === body.project_id)
          const duration = Number(body.duration_minutes ?? 0)
          const rounded = project ? roundMinutes(duration, project.rounding_minutes) : duration
          const entry: TimeEntry = {
            id: `entry-${entrySeq}`,
            tenant_id: 'tenant-journey',
            client_id: body.client_id ?? '',
            project_id: body.project_id ?? '',
            invoice_id: null,
            description: body.description ?? '',
            duration_minutes: duration,
            rounded_minutes: rounded,
            status: 'unbilled',
            started_at: body.started_at ?? null,
            ended_at: body.ended_at ?? null,
            created_at: now(),
            updated_at: now(),
          }
          store.entries.push(entry)
          return route.fulfill({
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          })
        }

        if (method === 'GET' && endpoint === '/invoices') {
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paginated(store.invoices)),
          })
        }

        const invoiceDetailMatch = endpoint.match(/^\/invoices\/([^/]+)$/)
        if (method === 'GET' && invoiceDetailMatch) {
          const id = invoiceDetailMatch[1]
          const invoice = store.invoices.find((i) => i.id === id)
          if (!invoice) {
            return route.fulfill({ status: 404, body: 'Not found' })
          }
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invoice),
          })
        }

        if (method === 'POST' && endpoint === '/invoices') {
          const body = request.postDataJSON() as Partial<InvoiceCreate>
          const client = store.clients.find((c) => c.id === body.client_id)
          const selectedEntries = store.entries.filter((e) =>
            body.time_entry_ids?.includes(e.id)
          )
          const rate = parseFloat(client?.default_hourly_rate ?? '0') || 0
          const currency = client?.currency ?? 'USD'

          const lineItems: InvoiceLineItem[] = selectedEntries.map((entry, idx) => {
            const hours = entry.rounded_minutes / 60
            const amount = (rate * hours).toFixed(2)
            return {
              id: `line-${idx + 1}`,
              description: entry.description,
              quantity: hours.toFixed(2),
              rate: rate.toFixed(2),
              amount: { amount, currency },
              time_entry_ids: [entry.id],
            }
          })

          const totalAmount = lineItems
            .reduce((sum, line) => sum + parseFloat(line.amount.amount), 0)
            .toFixed(2)

          invoiceSeq += 1
          const invoice: Invoice = {
            id: `invoice-${invoiceSeq}`,
            tenant_id: 'tenant-journey',
            client_id: body.client_id ?? '',
            status: 'sent',
            issue_date: body.issue_date ?? now().split('T')[0],
            due_date: body.due_date ?? now().split('T')[0],
            notes: body.notes ?? null,
            subtotal: { amount: totalAmount, currency },
            tax: { amount: '0.00', currency },
            total: { amount: totalAmount, currency },
            idempotency_key: body.idempotency_key ?? null,
            line_items: lineItems,
            created_at: now(),
            updated_at: now(),
          }

          selectedEntries.forEach((entry) => {
            entry.status = 'billed'
            entry.invoice_id = invoice.id
          })
          store.invoices.push(invoice)

          return route.fulfill({
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invoice),
          })
        }

        const markPaidMatch = endpoint.match(/^\/invoices\/([^/]+)\/mark-paid$/)
        if (method === 'POST' && markPaidMatch) {
          const id = markPaidMatch[1]
          const invoice = store.invoices.find((i) => i.id === id)
          if (!invoice) {
            return route.fulfill({ status: 404, body: 'Not found' })
          }
          invoice.status = 'paid'
          invoice.updated_at = now()
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invoice),
          })
        }

        return route.fulfill({ status: 404, body: 'Unhandled journey mock endpoint' })
      }
    )
  })

  test('login → client → project → time → invoice → payment', async ({ page }) => {
    // Login
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill('journey@example.com')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Create client
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Add client' }).click()
    await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible()
    await page.getByLabel('Name').fill('Acme Corp')
    await page.getByLabel('Email').fill('billing@acme.com')
    await page.getByLabel('Default hourly rate').fill('100')
    await page.getByRole('button', { name: 'Save client' }).click()
    await expect(page).toHaveURL('/clients')
    await expect(page.getByText('Acme Corp')).toBeVisible()

    // Create project
    await page.getByRole('link', { name: 'Projects' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Add project' }).click()
    await expect(page.getByRole('heading', { name: 'Add project' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByLabel('Name').fill('Website Redesign')
    await page.getByRole('button', { name: 'Save project' }).click()
    await expect(page).toHaveURL('/projects')
    await expect(page.getByText('Website Redesign')).toBeVisible()

    // Log time
    await page.getByRole('link', { name: 'Time tracker' }).click()
    await expect(page.getByRole('heading', { name: 'Time tracker', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Log time' }).click()
    await expect(page.getByRole('heading', { name: 'Quick time entry' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByLabel('Project').selectOption('Website Redesign')
    await page.getByLabel('Description').fill('Initial discovery')
    await page.getByLabel('Duration (minutes)').fill('60')
    await page.getByRole('dialog').getByRole('button', { name: 'Log time' }).click()
    await expect(page.getByText('Time entry logged')).toBeVisible()
    await expect(page.getByText('Initial discovery')).toBeVisible()

    // Create invoice
    await page.getByRole('link', { name: 'Invoices' }).click()
    await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '+ Create invoice' }).click()
    await expect(page.getByRole('heading', { name: 'Create invoice' })).toBeVisible()
    await page.getByLabel('Client').selectOption('Acme Corp')
    await page.getByText('Initial discovery').click()
    await page.getByRole('button', { name: 'Create invoice' }).click()

    // Invoice detail
    await expect(page).toHaveURL(/\/invoices\/invoice-\d+$/)
    await expect(page.getByRole('heading', { name: 'USD 100.00' })).toBeVisible()
    await expect(page.getByText('Sent')).toBeVisible()

    // Record payment
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByRole('heading', { name: 'Record payment' })).toBeVisible()
    await page.getByLabel('Payment method').fill('Bank transfer')
    await page.getByRole('button', { name: 'Mark paid' }).click()
    await expect(page.getByText('Invoice marked as paid')).toBeVisible()
    await expect(page.getByText('Paid', { exact: true })).toBeVisible()
  })
})

// Inline helper types to keep the mock self-contained.
interface ClientCreate {
  name: string
  email?: string
  currency?: string
  default_hourly_rate?: string
}

interface ProjectCreate {
  client_id: string
  name: string
  rounding_minutes?: number
}

interface TimeEntryCreate {
  client_id: string
  project_id: string
  description: string
  duration_minutes?: number
  started_at?: string
  ended_at?: string
}

interface InvoiceCreate {
  client_id: string
  time_entry_ids: string[]
  issue_date: string
  due_date: string
  notes?: string
  idempotency_key?: string
}

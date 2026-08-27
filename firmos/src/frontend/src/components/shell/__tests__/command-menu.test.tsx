import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchResults } from '@/shared/lib/search'

import { CommandMenu } from '../command-menu'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// The real module pulls server-action imports (and the quick-add dialogs)
// into the jsdom bundle; the palette only needs the item metadata.
vi.mock('@/components/quick-add/quick-add-menu', () => ({
  QUICK_ADD_ITEMS: [
    { kind: 'note', label: 'Quick note', hint: 'Sticky note', icon: () => null },
    { kind: 'task', label: 'New task', hint: 'One-off task', icon: () => null },
    { kind: 'template', label: 'Task from template', hint: 'Mint', icon: () => null },
    { kind: 'meeting', label: 'Log meeting', hint: 'Time entry', icon: () => null },
  ],
}))

const mockSearch = vi.fn()
const mockContext = vi.fn()
vi.mock('@/server/actions/search', () => ({
  globalSearchAction: (...args: unknown[]) => mockSearch(...args),
  paletteContextAction: (...args: unknown[]) => mockContext(...args),
}))

const mockClockStatus = vi.fn()
const mockClockIn = vi.fn()
const mockClockOut = vi.fn()
vi.mock('@/server/actions/time', () => ({
  getClockStatusAction: (...args: unknown[]) => mockClockStatus(...args),
  clockInAction: (...args: unknown[]) => mockClockIn(...args),
  clockOutAction: (...args: unknown[]) => mockClockOut(...args),
}))

const mockGenerate = vi.fn()
vi.mock('@/server/actions/invoices', () => ({
  generateMonthlyInvoicesAction: (...args: unknown[]) => mockGenerate(...args),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function storageStub(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', { value: storageStub(), configurable: true })
  Element.prototype.scrollIntoView = vi.fn()
  // cmdk measures the list with ResizeObserver; jsdom has none.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const RESULTS: SearchResults = {
  clients: [{ id: 7, title: 'Harborline Marine Supply', subtitle: null, href: '/clients/7' }],
  intakes: [],
  tasks: [{ id: 9, title: 'Harbor reconciliation', subtitle: 'Harborline', href: '/clients/7?tab=work' }],
  invoices: [],
  documents: [],
  notes: [],
}

function renderPalette(onQuickAdd = vi.fn()) {
  return render(<CommandMenu open onOpenChange={vi.fn()} onQuickAdd={onQuickAdd} />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  mockContext.mockResolvedValue({ ok: true, data: { role: 'owner' } })
  mockClockStatus.mockResolvedValue({
    ok: true,
    data: { clockedIn: false, dayElapsedMinutes: 0, dayStartedAt: null, currentActivity: null, openTaskTimers: [] },
  })
  mockSearch.mockResolvedValue({ ok: true, data: RESULTS })
})

describe('CommandMenu palette', () => {
  it('renders Actions and Navigation sections when the query is empty', async () => {
    renderPalette()
    expect(await screen.findByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Go to')).toBeInTheDocument()
    expect(screen.getByText('Quick note')).toBeInTheDocument()
    expect(screen.getByText('Log meeting')).toBeInTheDocument()
    expect(screen.getByText('Workstation')).toBeInTheDocument()
    expect(screen.getByText('Clients')).toBeInTheDocument()
  })

  it('shows the state-aware clock action once status loads', async () => {
    renderPalette()
    expect(await screen.findByText('Clock in')).toBeInTheDocument()
    expect(screen.queryByText('Clock out')).not.toBeInTheDocument()
  })

  it('gates Generate invoices to manager and above', async () => {
    mockContext.mockResolvedValue({ ok: true, data: { role: 'bookkeeper' } })
    renderPalette()
    await screen.findByText('Clock in') // context + clock resolved
    expect(screen.queryByText('Generate invoices')).not.toBeInTheDocument()
    // The invoices nav item is role-gated the same way (manager+ only).
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument()
  })

  it('shows Generate invoices for managers and runs the current-month generation', async () => {
    mockContext.mockResolvedValue({ ok: true, data: { role: 'manager' } })
    mockGenerate.mockResolvedValue({
      ok: true,
      data: { year: 2026, month: 8, invoicesCreated: 2, skippedExisting: 0 },
    })
    const user = userEvent.setup()
    renderPalette()
    await user.click(await screen.findByText('Generate invoices'))
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1))
  })

  it('runs a debounced search and renders grouped results', async () => {
    const user = userEvent.setup()
    renderPalette()
    await user.type(screen.getByPlaceholderText(/Search clients/), 'har')
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('har'), { timeout: 2000 })
    // Debounced: not called on the very first keystroke's microtask flush.
    expect((await screen.findAllByText('Clients')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Harborline Marine Supply')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Harbor reconciliation')).toBeInTheDocument()
  })

  it('opens the top search hit with Enter and records the recent', async () => {
    const user = userEvent.setup()
    renderPalette()
    const input = screen.getByPlaceholderText(/Search clients/)
    await user.type(input, 'har')
    await screen.findByText('Harborline Marine Supply')

    // cmdk auto-selects the first item; Enter opens it.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/clients/7'))
    const recents = JSON.parse(window.localStorage.getItem('firmos.palette.recentSearches.v1') ?? '[]')
    expect(recents).toEqual(['har'])
  })

  it('arrow-keys to a later hit and opens that one', async () => {
    const user = userEvent.setup()
    renderPalette()
    const input = screen.getByPlaceholderText(/Search clients/)
    await user.type(input, 'har')
    await screen.findByText('Harbor reconciliation')

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/clients/7?tab=work'))
  })

  it('shows recent searches when the query is empty and applies one on select', async () => {
    window.localStorage.setItem('firmos.palette.recentSearches.v1', JSON.stringify(['harborline']))
    const user = userEvent.setup()
    renderPalette()
    const recent = await screen.findByText('harborline')
    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    await user.click(recent)
    expect(screen.getByPlaceholderText(/Search clients/)).toHaveValue('harborline')
  })

  it('drives the quick-add callback from an action entry', async () => {
    const onQuickAdd = vi.fn()
    const user = userEvent.setup()
    renderPalette(onQuickAdd)
    await user.click(await screen.findByText('Quick note'))
    expect(onQuickAdd).toHaveBeenCalledWith('note')
  })

  it('shows the empty state when nothing matches', async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: { clients: [], intakes: [], tasks: [], invoices: [], documents: [], notes: [] },
    })
    const user = userEvent.setup()
    renderPalette()
    await user.type(screen.getByPlaceholderText(/Search clients/), 'zzzzzz')
    expect(await screen.findByText(/No results for/)).toBeInTheDocument()
  })

  it('clocks in from the action entry', async () => {
    mockClockIn.mockResolvedValue({ ok: true, data: { clockedIn: true } })
    const user = userEvent.setup()
    renderPalette()
    await user.click(await screen.findByText('Clock in'))
    await waitFor(() => expect(mockClockIn).toHaveBeenCalledTimes(1))
  })
})

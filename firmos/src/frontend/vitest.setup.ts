import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

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

vi.mock('@/server/actions/intake-setup', () => ({
  listSopTemplatesAction: vi.fn(async () => ({ ok: true, data: [] })),
  listVendorCatalogAction: vi.fn(async () => ({ ok: true, data: [] })),
  addVendorAction: vi.fn(),
  renameVendorAction: vi.fn(),
  setVendorDefaultsAction: vi.fn(),
  listReportCatalogAction: vi.fn(async () => ({ ok: true, data: [] })),
  addReportTypeAction: vi.fn(),
  renameReportTypeAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

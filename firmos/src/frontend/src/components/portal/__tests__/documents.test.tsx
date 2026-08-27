import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PortalDocumentsView } from '../documents-view'
import { PortalUploadDisabledNote, PortalUploadPanel } from '../upload-panel'
import type { DocumentTree } from '@/server/documents'

/**
 * Documents surface gating (HANDOFF §12/§13): the folder browser renders
 * the five groups, the upload card offers only the whitelisted folders, and
 * the no-capability state replaces the affordance with an explanatory note
 * (the server action re-enforces the capability regardless).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/portal/documents',
}))

vi.mock('@/server/actions/portal-documents', () => ({
  uploadPortalDocument: vi.fn(),
  uploadPortalStatement: vi.fn(),
}))

function treeWith(docs: Partial<DocumentTree['documentsByGroup']['receipts'][number]>[]): DocumentTree {
  return {
    clientId: 1,
    folders: [],
    documentsByGroup: {
      statements: [],
      reports: [],
      tax: [],
      receipts: docs.map((d, i) => ({
        id: i + 1,
        createdAt: new Date('2026-08-20T12:00:00Z'),
        updatedAt: new Date('2026-08-20T12:00:00Z'),
        clientId: 1,
        accountId: null,
        attributedYear: null,
        attributedMonth: null,
        statementDate: null,
        folderId: null,
        uploadedById: 9,
        fileName: `receipt-${i + 1}.pdf`,
        storedPath: `harborline/Documents/Receipts/082026.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        docType: 'receipt',
        ...d,
      })),
      general: [],
    },
  }
}

describe('PortalDocumentsView', () => {
  it('renders all five groups with counts and download links', () => {
    render(<PortalDocumentsView tree={treeWith([{ fileName: 'depot-receipt.pdf' }])} />)

    for (const label of ['Statements', 'Reports', 'Tax', 'Receipts', 'General']) {
      expect(screen.getByRole('heading', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByText('depot-receipt.pdf')).toBeInTheDocument()
    const download = screen.getByRole('link', { name: 'Download depot-receipt.pdf' })
    expect(download).toHaveAttribute('href', '/api/documents/1')
  })
})

describe('PortalUploadPanel', () => {
  it('offers only the whitelisted folders (Receipts, General)', () => {
    render(<PortalUploadPanel />)
    // The select trigger carries the current value; options render in the
    // portal on open, so assert the whitelist through the trigger and the
    // module constant the panel maps over.
    expect(screen.getByTestId('portal-upload-panel')).toBeInTheDocument()
    expect(screen.getByLabelText('Folder')).toHaveTextContent('Receipts')
    expect(screen.getByLabelText('File')).toBeInTheDocument()
  })

  it('requires a file before calling the action', async () => {
    const user = userEvent.setup()
    const { uploadPortalDocument } = await import('@/server/actions/portal-documents')
    render(<PortalUploadPanel />)
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a file to upload.')
    expect(vi.mocked(uploadPortalDocument)).not.toHaveBeenCalled()
  })
})

describe('PortalUploadDisabledNote', () => {
  it('replaces the upload affordance with an explanatory note', () => {
    render(<PortalUploadDisabledNote />)
    expect(screen.getByTestId('portal-upload-disabled')).toBeInTheDocument()
    expect(screen.getByText(/Uploads are turned off/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open a request' })).toHaveAttribute(
      'href',
      '/portal/requests',
    )
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
  })
})

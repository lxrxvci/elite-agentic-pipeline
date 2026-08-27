import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteDocumentAction, uploadDocumentAction } from '@/server/actions/documents'
import type { DocumentFolderNode } from '@/server/documents'

import { DocumentsPanel } from '../documents-panel'
import type { DocumentListItem } from '../view-model'

vi.mock('@/server/actions/documents', () => ({
  uploadDocumentAction: vi.fn(),
  deleteDocumentAction: vi.fn(),
  promoteToStatementAction: vi.fn(),
}))

const mockDelete = vi.mocked(deleteDocumentAction)
const mockUpload = vi.mocked(uploadDocumentAction)

const folders: DocumentFolderNode[] = [
  { id: null, name: 'Statements', isProtected: true, parentId: null, children: [] },
  { id: null, name: 'Reports', isProtected: true, parentId: null, children: [] },
  {
    id: 11,
    name: 'Contracts',
    isProtected: false,
    parentId: null,
    children: [
      { id: 12, name: 'Leases', isProtected: false, parentId: 11, children: [] },
    ],
  },
]

function doc(partial: Partial<DocumentListItem> & Pick<DocumentListItem, 'id' | 'fileName' | 'group'>): DocumentListItem {
  return {
    docType: 'general',
    sizeBytes: 2048,
    uploadedDay: '2026-08-20',
    uploaderName: 'Mara Voss',
    folderName: 'General',
    folderId: null,
    statementDate: null,
    attributedYear: null,
    attributedMonth: null,
    canDelete: false,
    ...partial,
  }
}

const documents: DocumentListItem[] = [
  doc({
    id: 1,
    fileName: '073126.pdf',
    docType: 'statement',
    group: 'statements',
    folderName: 'Statements',
    attributedYear: 2026,
    attributedMonth: 7,
  }),
  doc({ id: 2, fileName: 'w9-2026.pdf', docType: 'w9', group: 'tax', folderName: 'General' }),
  doc({ id: 3, fileName: 'office-lease.pdf', group: 'general', folderName: 'Leases', canDelete: true }),
  doc({ id: 4, fileName: 'depot-receipt.png', docType: 'receipt', group: 'receipts', folderName: 'General' }),
]

const accounts = [
  { id: 5, name: 'Operating Checking', institution: 'Chase' },
  { id: 6, name: 'Amex Gold', institution: null },
]

function renderPanel({ canManageStatements = true, docs = documents } = {}) {
  return render(
    <DocumentsPanel
      clientId={3}
      folders={folders}
      documents={docs}
      accounts={accounts}
      canManageStatements={canManageStatements}
    />,
  )
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  mockDelete.mockReset()
  mockUpload.mockReset()
})

describe('DocumentsPanel tree and grouping', () => {
  it('renders the protected virtual roots, real folders (nested), and type groups with counts', () => {
    renderPanel()
    const nav = screen.getByLabelText('Document folders')
    expect(within(nav).getByText('Statements')).toBeInTheDocument()
    expect(within(nav).getByText('Reports')).toBeInTheDocument()
    expect(within(nav).getByText('Contracts')).toBeInTheDocument()
    expect(within(nav).getByText('Leases')).toBeInTheDocument()
    expect(within(nav).getByText('Tax')).toBeInTheDocument()
    expect(within(nav).getByText('Receipts')).toBeInTheDocument()
    expect(within(nav).getByText('General')).toBeInTheDocument()
  })

  it('lists every document under All documents by default', () => {
    renderPanel()
    expect(screen.getAllByTestId('document-row')).toHaveLength(4)
  })

  it('filters the file list when a type group is selected', async () => {
    const user = userEvent.setup()
    renderPanel()
    const nav = screen.getByLabelText('Document folders')
    await user.click(within(nav).getByText('Receipts'))
    const rows = screen.getAllByTestId('document-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('depot-receipt.png')
  })

  it('filters the file list to a real folder by its stored-path segment', async () => {
    const user = userEvent.setup()
    renderPanel()
    const nav = screen.getByLabelText('Document folders')
    await user.click(within(nav).getByText('Leases'))
    const rows = screen.getAllByTestId('document-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('office-lease.pdf')
  })

  it('shows the attributed period chip on statements', () => {
    renderPanel()
    expect(screen.getByText('Jul 2026')).toBeInTheDocument()
  })
})

describe('DocumentsPanel permissions', () => {
  it('hides delete when the server says the user cannot delete, shows it when allowed', () => {
    renderPanel()
    const rows = screen.getAllByTestId('document-row')
    const statementRow = rows.find((r) => r.textContent?.includes('073126.pdf'))!
    const leaseRow = rows.find((r) => r.textContent?.includes('office-lease.pdf'))!
    expect(within(statementRow).queryByTestId('delete-trigger')).not.toBeInTheDocument()
    expect(within(leaseRow).getByTestId('delete-trigger')).toBeInTheDocument()
  })

  it('hides promote and upload actions without the statements permission', () => {
    renderPanel({ canManageStatements: false })
    expect(screen.queryByTestId('promote-trigger')).not.toBeInTheDocument()
    // Download is always available to staff.
    expect(screen.getAllByLabelText(/Download /).length).toBe(4)
  })

  it('offers promote only on general documents', () => {
    renderPanel()
    const rows = screen.getAllByTestId('document-row')
    const statementRow = rows.find((r) => r.textContent?.includes('073126.pdf'))!
    const taxRow = rows.find((r) => r.textContent?.includes('w9-2026.pdf'))!
    const leaseRow = rows.find((r) => r.textContent?.includes('office-lease.pdf'))!
    expect(within(statementRow).queryByTestId('promote-trigger')).not.toBeInTheDocument()
    expect(within(taxRow).queryByTestId('promote-trigger')).not.toBeInTheDocument()
    expect(within(leaseRow).getByTestId('promote-trigger')).toBeInTheDocument()
  })
})

describe('DocumentsPanel delete flow', () => {
  it('confirms before deleting and calls the action with the document id', async () => {
    const user = userEvent.setup()
    mockDelete.mockResolvedValue({ ok: true, data: null })
    renderPanel()
    const leaseRow = screen.getAllByTestId('document-row').find((r) => r.textContent?.includes('office-lease.pdf'))!
    await user.click(within(leaseRow).getByTestId('delete-trigger'))

    const dialog = screen.getByTestId('delete-dialog')
    expect(dialog).toHaveTextContent('office-lease.pdf')
    await user.click(within(dialog).getByTestId('delete-confirm'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(3))
  })
})

describe('DocumentsPanel upload', () => {
  it('uploads into the selected folder and surfaces server errors verbatim', async () => {
    const user = userEvent.setup()
    mockUpload.mockResolvedValue({ ok: false, error: 'That file is over the 50 MB limit.' })
    renderPanel()

    const input = screen.getByLabelText('Choose a file to upload')
    await user.upload(input, new File(['x'], 'big.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    const formData = mockUpload.mock.calls[0][0]
    expect(formData.get('clientId')).toBe('3')
    expect(formData.get('folder')).toBe('General')
    expect(formData.get('file')).toBeInstanceOf(File)
  })
})

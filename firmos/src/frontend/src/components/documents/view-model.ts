import type { DocumentGroup } from '@/server/documents'

/**
 * Presentation view model for the Documents tab. The server page maps
 * DocumentRows into DocumentListItems (resolving uploader names, upload
 * days, and the per-user delete permission) so this module stays pure and
 * the panel stays dumb.
 */

export interface DocumentListItem {
  id: number
  fileName: string
  docType: string
  group: DocumentGroup
  sizeBytes: number | null
  /** Firm-local ISO day the file was uploaded, or null when unknown. */
  uploadedDay: string | null
  uploaderName: string | null
  /** Folder segment derived from the deterministic stored path (§13). */
  folderName: string | null
  folderId: number | null
  statementDate: string | null
  attributedYear: number | null
  attributedMonth: number | null
  /** §13 deletion rules, resolved server-side for the current user. */
  canDelete: boolean
}

export type DocSelection =
  | { kind: 'all' }
  | { kind: 'group'; group: DocumentGroup; label: string }
  | { kind: 'folder'; name: string; isProtected: boolean }

/** {client}/Documents/{folder}/{file} - the folder segment of a stored path. */
export function folderNameOfPath(storedPath: string): string | null {
  const segments = storedPath.split('/').filter((s) => s !== '')
  if (segments.length >= 4 && segments[1] === 'Documents') return segments[2]
  return null
}

export function filterDocuments(docs: DocumentListItem[], selection: DocSelection): DocumentListItem[] {
  switch (selection.kind) {
    case 'all':
      return docs
    case 'group':
      return docs.filter((d) => d.group === selection.group)
    case 'folder': {
      const wanted = selection.name.toLowerCase()
      return docs.filter((d) => d.folderName?.toLowerCase() === wanted)
    }
  }
}

/** Doc count per folder name (lowercased) for tree badges. */
export function folderCounts(docs: DocumentListItem[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const d of docs) {
    if (!d.folderName) continue
    const key = d.folderName.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** "1.4 MB" / "238 KB" - size column, tabular numerals applied by the caller. */
export function sizeLabel(bytes: number | null): string {
  if (bytes == null || bytes < 0) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export const GROUP_LABELS: Record<DocumentGroup, string> = {
  statements: 'Statements',
  reports: 'Reports',
  tax: 'Tax',
  receipts: 'Receipts',
  general: 'General',
}

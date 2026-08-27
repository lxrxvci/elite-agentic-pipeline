'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileText,
  FolderClosed,
  Landmark,
  Loader2,
  Lock,
  ReceiptText,
  Scale,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { deleteDocumentAction, uploadDocumentAction } from '@/server/actions/documents'
import type { DocumentFolderNode } from '@/server/documents'
import { dayLabel, monthLabel } from '@/shared/lib/date-display'
import { cn } from '@/shared/lib/utils'

import { PromoteDialog, type PromoteAccount } from './promote-dialog'
import {
  GROUP_LABELS,
  filterDocuments,
  folderCounts,
  sizeLabel,
  type DocSelection,
  type DocumentListItem,
} from './view-model'

/**
 * Client detail - Documents tab (HANDOFF §7, §13): folder tree browser over
 * the virtual protected Statements/Reports roots plus real folders, with the
 * §13 doc_type grouping (Statements/Reports/Tax/Receipts/General). Delete
 * and promote render only when the server-resolved permission allows them;
 * statement uploads stay in the statement flow (protected folders are
 * read-only here).
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.docx,.doc,.txt,.zip'

const GROUP_ICONS = {
  statements: Landmark,
  reports: FileText,
  tax: Scale,
  receipts: ReceiptText,
  general: File,
} as const

interface DocumentsPanelProps {
  clientId: number
  folders: DocumentFolderNode[]
  documents: DocumentListItem[]
  accounts: PromoteAccount[]
  canManageStatements: boolean
}

function selectionLabel(sel: DocSelection): string {
  switch (sel.kind) {
    case 'all':
      return 'All documents'
    case 'group':
      return sel.label
    case 'folder':
      return sel.name
  }
}

export function DocumentsPanel({
  clientId,
  folders,
  documents,
  accounts,
  canManageStatements,
}: DocumentsPanelProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<DocSelection>({ kind: 'all' })
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [promoteTarget, setPromoteTarget] = useState<DocumentListItem | null>(null)

  const counts = useMemo(() => folderCounts(documents), [documents])
  const visible = useMemo(() => filterDocuments(documents, selection), [documents, selection])

  const uploadFolder =
    selection.kind === 'folder' && !selection.isProtected
      ? selection.name
      : selection.kind === 'all' || (selection.kind === 'group' && selection.group === 'general')
        ? 'General'
        : null

  async function upload(file: File | null | undefined) {
    if (!file || uploadFolder == null) return
    setUploading(true)
    const formData = new FormData()
    formData.set('clientId', String(clientId))
    formData.set('folder', uploadFolder)
    formData.set('file', file)
    const res = await uploadDocumentAction(formData)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!res.ok) {
      // Upload validation messages are human-readable by contract.
      toast.error(res.error)
      return
    }
    toast.success(`Uploaded ${res.data.fileName} to ${uploadFolder}`)
    router.refresh()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const res = await deleteDocumentAction(deleteTarget.id)
    setDeleting(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Deleted ${deleteTarget.fileName}`)
    setDeleteTarget(null)
    router.refresh()
  }

  function treeNode(node: DocumentFolderNode, depth: number) {
    const isVirtualProtected = node.id == null && node.isProtected
    const group = isVirtualProtected ? (node.name.toLowerCase() === 'statements' ? 'statements' : 'reports') : null
    const sel: DocSelection = group
      ? { kind: 'group', group, label: node.name }
      : { kind: 'folder', name: node.name, isProtected: node.isProtected }
    const isSelected =
      (sel.kind === 'group' && selection.kind === 'group' && selection.group === sel.group) ||
      (sel.kind === 'folder' &&
        selection.kind === 'folder' &&
        selection.name.toLowerCase() === sel.name.toLowerCase())
    const count = counts.get(node.name.toLowerCase()) ?? 0
    const hasChildren = node.children.length > 0
    const isCollapsed = node.id != null && collapsed.has(node.id)

    return (
      <div key={node.id ?? `virtual-${node.name}`}>
        <div
          className={cn(
            'group flex h-7 items-center gap-1 rounded-md pr-2 text-[13px]',
            isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
          )}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (node.id != null && next.has(node.id)) next.delete(node.id)
                  else if (node.id != null) next.add(node.id)
                  return next
                })
              }
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => setSelection(sel)}
            aria-current={isSelected ? 'true' : undefined}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            data-testid="folder-node"
            data-folder={node.name}
          >
            <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{node.name}</span>
            {node.isProtected && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="tnum ml-auto text-[11px] text-muted-foreground">{count}</span>
          </button>
        </div>
        {!isCollapsed && node.children.map((child) => treeNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]" data-testid="documents-panel">
      {/* Folder tree */}
      <nav aria-label="Document folders" className="space-y-0.5 rounded-xl border border-border bg-card p-2">
        <button
          type="button"
          onClick={() => setSelection({ kind: 'all' })}
          aria-current={selection.kind === 'all' ? 'true' : undefined}
          data-testid="folder-node"
          data-folder="all"
          className={cn(
            'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px]',
            selection.kind === 'all' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
          )}
        >
          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium">All documents</span>
          <span className="tnum ml-auto text-[11px] text-muted-foreground">{documents.length}</span>
        </button>

        {folders.map((node) => treeNode(node, 0))}

        <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          By type
        </p>
        {(['tax', 'receipts', 'general'] as const).map((group) => {
          const Icon = GROUP_ICONS[group]
          const isSelected = selection.kind === 'group' && selection.group === group
          return (
            <button
              key={group}
              type="button"
              onClick={() => setSelection({ kind: 'group', group, label: GROUP_LABELS[group] })}
              aria-current={isSelected ? 'true' : undefined}
              data-testid="folder-node"
              data-folder={group}
              className={cn(
                'flex h-7 w-full items-center gap-1.5 rounded-md px-2 pl-7 text-left text-[13px]',
                isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-medium">{GROUP_LABELS[group]}</span>
              <span className="tnum ml-auto text-[11px] text-muted-foreground">
                {documents.filter((d) => d.group === group).length}
              </span>
            </button>
          )
        })}
      </nav>

      {/* File list */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex h-11 items-center justify-between gap-2 border-b border-border px-4">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {selectionLabel(selection)}
            <span className="tnum ml-2 text-[11px] font-normal text-muted-foreground">
              {visible.length} {visible.length === 1 ? 'file' : 'files'}
            </span>
          </h3>
          {uploadFolder != null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              data-testid="document-upload-trigger"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-3.5 w-3.5" aria-hidden />
              )}
              Upload to {uploadFolder}
            </Button>
          ) : (
            selection.kind === 'group' &&
            (selection.group === 'statements' || selection.group === 'reports') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" aria-hidden />
                    Managed by the {selection.group === 'statements' ? 'statement' : 'report'} flow
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Upload statements from the Statements tab so they attribute to an accounting month.
                </TooltipContent>
              </Tooltip>
            )
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label="Choose a file to upload"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            No files here yet.
          </p>
        ) : (
          <ul data-testid="document-list">
            {visible.map((doc) => (
              <li
                key={doc.id}
                data-testid="document-row"
                data-document-id={doc.id}
                className="flex h-11 items-center gap-3 border-b border-border px-4 last:border-b-0"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <File className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{doc.fileName}</span>
                  {doc.group === 'statements' && doc.attributedYear != null && doc.attributedMonth != null && (
                    <span className="tnum shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {monthLabel(doc.attributedYear, doc.attributedMonth)}
                    </span>
                  )}
                </div>
                <span className="tnum hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block">
                  {doc.uploadedDay ? dayLabel(doc.uploadedDay) : 'Unknown'}
                </span>
                <span className="tnum hidden w-16 shrink-0 text-right text-xs text-muted-foreground md:block">
                  {sizeLabel(doc.sizeBytes)}
                </span>
                <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground lg:block">
                  {doc.uploaderName ?? 'Unknown'}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <a
                    href={`/api/documents/${doc.id}`}
                    download
                    aria-label={`Download ${doc.fileName}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  {canManageStatements && doc.group === 'general' && accounts.length > 0 && (
                    <button
                      type="button"
                      aria-label={`Promote ${doc.fileName} to statement`}
                      data-testid="promote-trigger"
                      onClick={() => setPromoteTarget(doc)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Landmark className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {doc.canDelete && (
                    <button
                      type="button"
                      aria-label={`Delete ${doc.fileName}`}
                      data-testid="delete-trigger"
                      onClick={() => setDeleteTarget(doc)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-status-overdue-bg hover:text-status-overdue"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md" data-testid="delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `“${deleteTarget.fileName}” is removed from the document tree. This cannot be undone.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              data-testid="delete-confirm"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PromoteDialog
        open={promoteTarget != null}
        onOpenChange={(o) => !o && setPromoteTarget(null)}
        document={promoteTarget ? { id: promoteTarget.id, fileName: promoteTarget.fileName } : null}
        accounts={accounts}
      />
    </div>
  )
}

import { FolderOpen } from 'lucide-react'

import type { DocumentGroup, DocumentTree } from '@/server/documents'

import { PortalDocumentTable } from './document-table'

/**
 * Portal folder browser (HANDOFF §12): the five §13 document groups as
 * fixed sections. Statements and Reports are read-only here - statement
 * uploads go through the Statements grid, and report files come from the
 * firm. The upload affordance (whitelisted folders only) lives above the
 * groups and disappears entirely when can_upload_docs is off.
 */

const GROUP_ORDER: { key: DocumentGroup; label: string; hint: string }[] = [
  { key: 'statements', label: 'Statements', hint: 'Bank and card statements, uploaded per account on the Statements page.' },
  { key: 'reports', label: 'Reports', hint: 'Reports delivered by your firm.' },
  { key: 'tax', label: 'Tax', hint: 'Tax documents and W-9s.' },
  { key: 'receipts', label: 'Receipts', hint: 'Receipts you have sent in.' },
  { key: 'general', label: 'General', hint: 'Everything else.' },
]

export function PortalDocumentsView({ tree }: { tree: DocumentTree }) {
  return (
    <div className="flex flex-col gap-6">
      {GROUP_ORDER.map((group) => {
        const docs = tree.documentsByGroup[group.key]
        return (
          <section key={group.key} aria-labelledby={`portal-docs-${group.key}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 id={`portal-docs-${group.key}`} className="text-sm font-semibold">
                {group.label}
                <span className="tnum ml-2 text-xs font-normal text-muted-foreground">
                  {docs.length} {docs.length === 1 ? 'file' : 'files'}
                </span>
              </h2>
            </div>
            {docs.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-4 text-[13px] text-muted-foreground">
                <FolderOpen aria-hidden className="h-4 w-4 shrink-0" />
                <span>Nothing here yet. {group.hint}</span>
              </div>
            ) : (
              <PortalDocumentTable documents={docs} />
            )}
          </section>
        )
      })}
    </div>
  )
}

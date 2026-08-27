import { Download, FileText } from 'lucide-react'

import { formatBytes, formatInstant } from './format'

/**
 * Read-only document list with download links (HANDOFF §12/§13). Downloads
 * go through /api/documents/[id], which enforces the portal linked-client
 * scope (and the CPA folder-prefix scope) server-side on every request.
 * Server component - no interactivity beyond plain links.
 */

export interface PortalDocumentItem {
  id: number
  fileName: string
  sizeBytes: number | null
  createdAt: Date
}

export function PortalDocumentTable({ documents }: { documents: PortalDocumentItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="w-24 px-3 py-2 text-right font-medium">Size</th>
            <th scope="col" className="w-32 px-3 py-2 font-medium">Uploaded</th>
            <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/40">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">{doc.fileName}</span>
                </span>
              </td>
              <td className="tnum px-3 py-2 text-right text-muted-foreground">
                {doc.sizeBytes != null ? formatBytes(doc.sizeBytes) : '-'}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatInstant(doc.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <a
                  href={`/api/documents/${doc.id}`}
                  aria-label={`Download ${doc.fileName}`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-primary hover:bg-accent hover:underline"
                >
                  <Download aria-hidden className="h-3.5 w-3.5" />
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

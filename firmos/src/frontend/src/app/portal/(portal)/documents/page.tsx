import type { Metadata } from 'next'

import { PortalDocumentsView } from '@/components/portal/documents-view'
import { requireClientRolePage } from '@/components/portal/server'
import { PortalUploadDisabledNote, PortalUploadPanel } from '@/components/portal/upload-panel'
import { getDocumentTree } from '@/server/documents'

export const metadata: Metadata = { title: 'Portal documents - FirmOS' }

/**
 * Portal documents (HANDOFF §12/§13). Everything on this page comes through
 * the portal engine's scoping: the acting client from the cookie-backed
 * selection, the tree from the documents engine for that client only, and
 * downloads through the portal-scoped API route.
 */
export default async function PortalDocumentsPage() {
  const { access } = await requireClientRolePage()
  if (!access) return null

  const tree = await getDocumentTree(access.clientId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Files for {access.clientName}, organized by folder.
        </p>
      </div>

      {access.capabilities.canUploadDocs ? <PortalUploadPanel /> : <PortalUploadDisabledNote />}

      <PortalDocumentsView tree={tree} />
    </div>
  )
}

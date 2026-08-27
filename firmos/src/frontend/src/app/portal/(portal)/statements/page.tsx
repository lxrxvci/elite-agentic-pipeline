import type { Metadata } from 'next'

import { requireClientRolePage } from '@/components/portal/server'
import { PortalStatementsGrid } from '@/components/portal/statements-grid'
import { localToday } from '@/server/dates'
import { getStatementsGrid } from '@/server/statements'

export const metadata: Metadata = { title: 'Portal statements - FirmOS' }

/**
 * Portal statements (HANDOFF §12, §14): the per-account by-month grid for
 * the acting client. Click-to-upload only when the firm granted
 * can_upload_docs; otherwise the grid is read-only with an explanatory
 * note. Cell states are computed by the statements engine (missing only
 * after the release date has passed, §29 fix).
 */
export default async function PortalStatementsPage() {
  const { access } = await requireClientRolePage()
  if (!access) return null

  const grid = await getStatementsGrid(access.clientId, localToday())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Statements</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Monthly statement tracking for {access.clientName}
          {access.capabilities.canUploadDocs
            ? ' - select a highlighted month to upload.'
            : '.'}
        </p>
      </div>

      <PortalStatementsGrid grid={grid} canUpload={access.capabilities.canUploadDocs} />
    </div>
  )
}

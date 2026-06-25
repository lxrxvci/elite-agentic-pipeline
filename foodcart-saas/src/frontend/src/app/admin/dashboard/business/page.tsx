import { DashboardShell } from '@/features/site/ui/DashboardShell'
import { BusinessInfoEditor } from '@/features/site/ui/BusinessInfoEditor'

export default function BusinessPage() {
  return (
    <DashboardShell>
      <BusinessInfoEditor />
    </DashboardShell>
  )
}

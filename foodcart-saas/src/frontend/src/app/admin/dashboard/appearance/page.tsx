import { DashboardShell } from '@/features/site/ui/DashboardShell'
import { AppearanceEditor } from '@/features/site/ui/AppearanceEditor'

export default function AppearancePage() {
  return (
    <DashboardShell>
      <AppearanceEditor />
    </DashboardShell>
  )
}

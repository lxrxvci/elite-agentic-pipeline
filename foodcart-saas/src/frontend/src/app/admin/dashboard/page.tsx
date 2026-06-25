import { DashboardShell } from '@/features/site/ui/DashboardShell'
import { DashboardOverview } from '@/features/site/ui/DashboardOverview'

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardOverview />
    </DashboardShell>
  )
}

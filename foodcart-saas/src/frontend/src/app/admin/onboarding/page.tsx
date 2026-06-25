import { OnboardingWizard } from '@/features/onboarding/ui/OnboardingWizard'
import { AdminProtectedRoute } from '@/features/auth/ui/AdminProtectedRoute'

export default function OnboardingPage() {
  return (
    <AdminProtectedRoute>
      <OnboardingWizard />
    </AdminProtectedRoute>
  )
}

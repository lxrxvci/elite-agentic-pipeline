import { ClerkProvider } from '@clerk/nextjs'
import { ClerkAdminAuthProvider } from '@/features/auth/ui/ClerkAdminAuthProvider'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ClerkAdminAuthProvider>{children}</ClerkAdminAuthProvider>
    </ClerkProvider>
  )
}

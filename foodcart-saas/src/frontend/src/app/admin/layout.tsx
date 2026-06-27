import { ClerkProvider } from '@clerk/nextjs'
import { ClerkAdminAuthProvider } from '@/features/auth/ui/ClerkAdminAuthProvider'
import { InsideClerkProvider } from '@/features/auth/ui/ClerkContext'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <InsideClerkProvider>
        <ClerkAdminAuthProvider>{children}</ClerkAdminAuthProvider>
      </InsideClerkProvider>
    </ClerkProvider>
  )
}

import { ContactRound } from 'lucide-react'

import { PagePlaceholder } from '@/components/page-placeholder'

export const metadata = { title: 'FirmOS - Contacts' }

export default function ContactsPage() {
  return (
    <PagePlaceholder
      title="Contacts"
      description="Every person at every client, with their role, portal access, and communication preferences."
      icon={ContactRound}
      empty={{
        title: 'No contacts yet',
        description:
          'Contacts attach to clients as they’re added - including who gets statements and who answers document requests.',
        actionLabel: 'Add a contact',
        actionMessage: 'The contact directory is being wired up.',
      }}
    />
  )
}

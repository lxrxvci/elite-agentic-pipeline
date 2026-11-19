import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { INTAKE_STATUS } from '@/components/intake/format'
import { getContactHistory } from '@/server/contact-history'

export const metadata: Metadata = { title: 'FirmOS - Contact history' }
export const dynamic = 'force-dynamic'

const roleLabels: Record<string, string> = {
  primary_contact: 'Main contact',
  owner: 'Owner',
  cpa: 'CPA',
  related: 'Contact',
  referral: 'Referral',
}

export default async function ContactHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const result = await getContactHistory(id)
  if (!result) notFound()
  const { contact, clients, intakes } = result
  const emails = [...new Set([contact.email, ...(contact.emails ?? [])].filter((value): value is string => Boolean(value)))]
  const phones = [...new Set([contact.phone, ...(contact.phones ?? [])].filter((value): value is string => Boolean(value)))]

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-8 pb-10">
      <div>
        <Link href="/contacts" className="text-sm text-primary hover:underline">All contacts</Link>
        <h1 className="mt-3 font-display text-2xl font-semibold text-foreground" data-testid="contact-name">{contact.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">One contact record across clients and intakes.</p>
      </div>

      <section aria-labelledby="contact-channels" className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 id="contact-channels" className="text-sm font-semibold">Email addresses</h2>
          {emails.length > 0 ? <ul className="mt-2 space-y-1 text-sm">{emails.map((email) => <li key={email}>{email}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No email addresses on file.</p>}
        </div>
        <div>
          <h2 className="text-sm font-semibold">Phone numbers</h2>
          {phones.length > 0 ? <ul className="mt-2 space-y-1 text-sm">{phones.map((phone) => <li key={phone}>{phone}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No phone numbers on file.</p>}
        </div>
      </section>

      <section aria-labelledby="contact-clients">
        <h2 id="contact-clients" className="text-base font-semibold">Businesses and roles</h2>
        {clients.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {clients.map((client) => <li key={`${client.id}-${client.role}`} className="text-sm"><Link href={`/clients/${client.id}`} className="font-medium text-primary hover:underline">{client.name}</Link><span className="text-muted-foreground"> · {client.roleLabel ?? roleLabels[client.role] ?? client.role}</span></li>)}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">No converted client associations yet.</p>}
      </section>

      <section aria-labelledby="contact-intakes">
        <h2 id="contact-intakes" className="text-base font-semibold">Intake history</h2>
        {intakes.length > 0 ? (
          <ul className="mt-3 space-y-5">
            {intakes.map((intake) => {
              const status = INTAKE_STATUS[intake.status]
              return (
                <li key={`${intake.id}-${intake.role}`} data-testid="contact-intake">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <Link href={`/intake/${intake.id}`} className="text-sm font-medium text-primary hover:underline">{intake.name}</Link>
                      <span className="text-sm text-muted-foreground"> · {roleLabels[intake.role] ?? intake.role}</span>
                    </div>
                    {intake.canResume && <Link href={`/intake/${intake.id}`} className="text-sm font-medium text-primary hover:underline">Resume intake</Link>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{status.label} · {intake.answered} of {intake.total} cards reached</p>
                  <p className="mt-1 text-xs text-muted-foreground">Started {intake.createdAt.toLocaleDateString('en-US')} · Updated {intake.updatedAt.toLocaleDateString('en-US')}{intake.convertedAt ? ` · Converted ${intake.convertedAt.toLocaleDateString('en-US')}` : ''}</p>
                </li>
              )
            })}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">No intake history yet.</p>}
      </section>
    </div>
  )
}

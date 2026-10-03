import type { Metadata } from 'next'

import { EmailTemplatesAdmin } from '@/components/admin/email-templates-admin'
import { SettingsForm } from '@/components/admin/settings-form'
import { getAdminSettings } from '@/server/admin-reads'
import { EMAIL_TEMPLATE_DEFS, getEmailTemplateOverrides } from '@/server/email-template-overrides'
import { requireRole } from '@/server/auth/guards'

export const metadata: Metadata = { title: 'FirmOS - Admin - Settings' }

/**
 * /admin/settings - the §27 settings inventory backed by app_settings. Every
 * save is admin/owner-only and audit-logged through the action layer.
 */
export default async function AdminSettingsPage() {
  await requireRole('admin', 'owner')
  const [settings, emailOverrides] = await Promise.all([getAdminSettings(), getEmailTemplateOverrides()])
  return (
    <div className="space-y-4">
      <SettingsForm settings={settings} />
      <EmailTemplatesAdmin defs={EMAIL_TEMPLATE_DEFS} overrides={Object.fromEntries(emailOverrides)} />
    </div>
  )
}

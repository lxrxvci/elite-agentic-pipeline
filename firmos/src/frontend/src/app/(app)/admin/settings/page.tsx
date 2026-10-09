import type { Metadata } from 'next'
import { asc, eq } from 'drizzle-orm'

import { EmailTemplatesAdmin } from '@/components/admin/email-templates-admin'
import { SettingsForm } from '@/components/admin/settings-form'
import { UserSkillsAdmin } from '@/components/admin/user-skills-admin'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getAdminSettings } from '@/server/admin-reads'
import { EMAIL_TEMPLATE_DEFS, getEmailTemplateOverrides } from '@/server/email-template-overrides'
import { requireRole } from '@/server/auth/guards'
import { listUserSkills } from '@/server/user-skills'

export const metadata: Metadata = { title: 'FirmOS - Admin - Settings' }

/**
 * /admin/settings - the §27 settings inventory backed by app_settings. Every
 * save is admin/owner-only and audit-logged through the action layer.
 */
export default async function AdminSettingsPage() {
  await requireRole('admin', 'owner')
  const [settings, emailOverrides, staffRows, skillRows] = await Promise.all([
    getAdminSettings(),
    getEmailTemplateOverrides(),
    // L6 (I6): the skill-tree editor's staff list + current levels.
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.firstName)),
    listUserSkills(),
  ])
  const staff = staffRows.map((u) => ({
    id: u.id,
    name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || `Staff ${u.id}`,
  }))
  return (
    <div className="space-y-4">
      <SettingsForm settings={settings} />
      <EmailTemplatesAdmin defs={EMAIL_TEMPLATE_DEFS} overrides={Object.fromEntries(emailOverrides)} />
      <UserSkillsAdmin staff={staff} rows={skillRows} />
    </div>
  )
}

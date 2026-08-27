import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { formatLocalDate } from '@firmos/domain'

import { ClientDetailTabs } from '@/components/clients/client-detail-tabs'
import { ClientRecurringPanel } from '@/components/clients/client-recurring-panel'
import { cadenceTierLabel, fullDateLabel } from '@/components/clients/format'
import { ClientStateChip } from '@/components/clients/state-chip'
import type { ClientInvoiceRef } from '@/components/clients/billing-panel'
import { DocumentsPanel } from '@/components/documents/documents-panel'
import { folderNameOfPath, type DocumentListItem } from '@/components/documents/view-model'
import { ClientPropertiesPanel } from '@/components/properties/client-properties-panel'
import { ClientProjectsPanel } from '@/components/projects/client-projects-panel'
import type {
  ProformaCellItem,
  ProformaRequestItem,
  PropertyItem,
} from '@/components/properties/view-model'
import { ClientStatementsPanel } from '@/components/statements/client-statements-panel'
import { ClientTaxPanel, type TaxChecklistItem } from '@/components/tax/client-tax-panel'
import { ClientW9Panel, type W9RecipientItem } from '@/components/w9/client-w9-panel'
import { OffboardingPanel, type OffboardingState } from '@/components/templates/offboarding-panel'
import { StaffAvatars } from '@/components/clients/staff-avatars'
import { db } from '@/db'
import { invoices, projects, projectTasks, users } from '@/db/schema'
import { getClientBilling, getClientDetail, getClientWork } from '@/server/clients'
import { canAccessStatements, requireStaff } from '@/server/auth/guards'
import { localToday } from '@/server/dates'
import { getClientYearGrid } from '@/server/year-grid'
import { canDeleteDocument, documentGroupOf, getDocumentTree } from '@/server/documents'
import { getAccountStatementStatus, getStatementsGrid, type StatementStatus } from '@/server/statements'
import { getOrCreateClientChecklist } from '@/server/tax'
import { OFFBOARDING_PROJECT_NAME } from '@/server/templates'
import { getClientProperties, getProformaStatus, normalizeDepreciation } from '@/server/properties'
import { listProjects } from '@/server/projects'
import { listClientRules } from '@/server/recurring-rules'
import { listW9Recipients } from '@/server/w9'

export const metadata: Metadata = { title: 'FirmOS - Client' }

// Per-user, per-day data - never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * Client record: profile header plus grouped tab clusters. Visibility rules
 * (HANDOFF §10) are decided HERE, server-side: billing is only fetched for
 * owner/admin (getClientBilling also role-guards itself), so unauthorized
 * users never receive the data in any payload.
 */
export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; year?: string }>
}) {
  const { id: rawId } = await params
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const { tab, year: rawYear } = await searchParams

  const user = await requireStaff()
  const canSeeBilling = user.normalizedRole === 'owner' || user.normalizedRole === 'admin'
  const canManageTax = ['manager', 'admin', 'owner'].includes(user.normalizedRole)
  // Work-day editor on the Overview tab (manager+; the action re-guards).
  const canEditWorkDay = ['manager', 'admin', 'owner'].includes(user.normalizedRole)
  // Team assignment on the Overview tab (manager+; the action re-guards).
  const canAssignStaff = ['manager', 'admin', 'owner'].includes(user.normalizedRole)
  const today = localToday()
  const parsedYear = Number(rawYear)
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : today.year

  const detail = await getClientDetail(id)
  if (!detail) notFound()

  // §22: the offboarding surface reads the client's "Offboarding" project
  // (any status - a completed one is the finalized record).
  const offboardingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, id), eq(projects.name, OFFBOARDING_PROJECT_NAME)))
    .orderBy(desc(projects.id))
    .limit(1)

  const [work, billing, statementsGrid, documentTree, staffRows, clientInvoiceRows, taxChecklistRows, w9Rows, offboardingTaskRows, yearGrid, clientRules] = await Promise.all([
    getClientWork(id),
    canSeeBilling ? getClientBilling(id) : Promise.resolve(null),
    getStatementsGrid(id, today),
    getDocumentTree(id),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role, isActive: users.isActive }).from(users),
    // Billing tab sub-section: recent invoices, owner/admin only (§10).
    canSeeBilling
      ? db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            status: invoices.status,
            year: invoices.year,
            month: invoices.month,
            total: invoices.total,
            dueDate: invoices.dueDate,
          })
          .from(invoices)
          .where(eq(invoices.clientId, id))
          .orderBy(desc(invoices.id))
          .limit(10)
      : Promise.resolve([]),
    // Tax tab: auto-populates from the firm templates on first access (§18).
    getOrCreateClientChecklist(id, year),
    listW9Recipients(year, id),
    offboardingProjects[0]
      ? db.select().from(projectTasks).where(eq(projectTasks.projectId, offboardingProjects[0].id)).orderBy(asc(projectTasks.position), asc(projectTasks.id))
      : Promise.resolve([]),
    // Work tab year grid: same `year` searchParam the tax/W-9 tabs use.
    getClientYearGrid(id, year, today),
    // Recurring tab: the client's schedule rules (§6.4).
    listClientRules(id, today),
  ])
  if (!work || !yearGrid) notFound()

  const clientInvoices: ClientInvoiceRef[] = clientInvoiceRows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? `INV-${r.id}`,
    status: r.status,
    year: r.year,
    month: r.month,
    total: r.total ?? '0.00',
    dueDate: r.dueDate,
  }))

  // Statements tab: fresh engine status per account (§6.7) for the status lines.
  const statusEntries = await Promise.all(
    statementsGrid.accounts.map(
      async (a) => [a.accountId, await getAccountStatementStatus(a.accountId, today)] as const,
    ),
  )
  const statusByAccount: Record<number, StatementStatus> = Object.fromEntries(statusEntries)

  // Documents tab: resolve uploader names, upload days, and the per-user
  // delete permission server-side so the panel never decides authorization.
  const nameById = new Map(staffRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`] as const))
  // Team-assignment selects (Overview tab): active staff, role-fit per slot,
  // only computed for roles allowed to edit.
  const staffNameOf = (u: (typeof staffRows)[number]) =>
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || `Staff ${u.id}`
  const managers = canAssignStaff
    ? staffRows
        .filter((u) => u.isActive && ['owner', 'admin', 'manager'].includes(u.role.toLowerCase()))
        .map((u) => ({ id: u.id, name: staffNameOf(u) }))
    : []
  const bookkeepers = canAssignStaff
    ? staffRows
        .filter((u) => u.isActive && u.role.toLowerCase() === 'bookkeeper')
        .map((u) => ({ id: u.id, name: staffNameOf(u) }))
    : []
  const canManage = canAccessStatements(user)
  const allDocs = Object.values(documentTree.documentsByGroup).flat()
  const documentItems: DocumentListItem[] = allDocs.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    docType: d.docType,
    group: documentGroupOf(d.docType),
    sizeBytes: d.sizeBytes,
    uploadedDay: d.createdAt ? formatLocalDate(localToday(new Date(d.createdAt))) : null,
    uploaderName: d.uploadedById != null ? (nameById.get(d.uploadedById) ?? null) : null,
    folderName: folderNameOfPath(d.storedPath),
    folderId: d.folderId,
    statementDate: d.statementDate,
    attributedYear: d.attributedYear,
    attributedMonth: d.attributedMonth,
    canDelete: canDeleteDocument(user, d, today),
  }))
  const promoteAccounts = detail.accounts
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, name: a.name, institution: a.institution }))

  // Tax tab: resolve assignee names server-side (§18 panel gets plain data).
  const taxItems: TaxChecklistItem[] = taxChecklistRows.map((row) => ({
    id: row.id,
    title: row.title,
    isCompleted: row.isCompleted,
    isCustom: row.templateId == null,
    assigneeName: row.assigneeId != null ? (nameById.get(row.assigneeId) ?? null) : null,
    notes: row.notes,
    cpaNotes: row.cpaNotes,
  }))

  // W-9/1099 tab: strip Date/Timestamp fields into plain strings.
  const w9Items: W9RecipientItem[] = w9Rows.map((row) => ({
    id: row.id,
    vendorName: row.vendorName,
    email: row.email,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    taxId: row.taxId,
    totalPaid: row.totalPaid,
    paymentType: row.paymentType,
    needs1099ManualOverride: row.needs1099ManualOverride,
    status: row.status,
    w9RequestedAt: row.w9RequestedAt ? row.w9RequestedAt.toISOString() : null,
    w9ReceivedDate: row.w9ReceivedDate,
    form1099SentDate: row.form1099SentDate,
    w9DocumentId: row.w9DocumentId,
  }))

  // Properties tab (§20): fetched only for real-estate clients, mapped to
  // plain serializable items (names resolved server-side).
  let propertyItems: PropertyItem[] = []
  let proformaCells: ProformaCellItem[] = []
  let proformaRequest: ProformaRequestItem | null = null
  let proformaRequiredCount = 0
  let proformaSubmittedCount = 0
  if (detail.isRealEstateClient) {
    const [propertyRows, proformaStatus] = await Promise.all([
      getClientProperties(id),
      getProformaStatus(id, year),
    ])
    propertyItems = propertyRows.map((p) => ({
      id: p.id,
      name: p.name,
      propertyType: p.propertyType,
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      city: p.city,
      state: p.state,
      zip: p.zip,
      isSold: p.isSold,
      soldDate: p.soldDate,
      salePrice: p.salePrice,
      purchasePrice: p.purchasePrice,
      purchaseDate: p.purchaseDate,
      annualRevenue: p.annualRevenue,
      annualExpenses: p.annualExpenses,
      mortgageLender: p.mortgageLender,
      mortgageBalance: p.mortgageBalance,
      monthlyMortgagePayment: p.monthlyMortgagePayment,
      depreciation: normalizeDepreciation(p.depreciation),
      qboClassName: p.qboClassName,
      merchantProcessor: p.merchantProcessor,
    }))
    proformaCells = proformaStatus.cells.map((c) => ({
      propertyId: c.propertyId,
      propertyName: c.propertyName,
      isSold: c.isSold,
      status: c.status,
      figures: (c.proforma?.figures ?? {}) as ProformaCellItem['figures'],
      fromPortal: c.proforma?.fromPortal ?? false,
      lastEditedAt: c.proforma?.lastEditedAt ?? null,
      lastEditedByName:
        c.proforma?.lastEditedById != null ? (nameById.get(c.proforma.lastEditedById) ?? null) : null,
    }))
    proformaRequest = proformaStatus.request
      ? {
          id: proformaStatus.request.id,
          status: proformaStatus.request.status,
          createdAt: proformaStatus.request.createdAt,
          completedAt: proformaStatus.request.completedAt,
          requestedByName: nameById.get(proformaStatus.request.requestedById) ?? null,
        }
      : null
    proformaRequiredCount = proformaStatus.requiredCount
    proformaSubmittedCount = proformaStatus.submittedCount
  }

  // Offboarding tab: admin/owner or the client's manager may start it (§22);
  // the action itself currently re-guards to admin/owner.
  const offboardingProject = offboardingProjects[0]
  const offboarding: OffboardingState | null = offboardingProject
    ? {
        projectId: offboardingProject.id,
        projectStatus: offboardingProject.status,
        tasks: offboardingTaskRows.map((t) => ({
          id: t.id,
          title: t.title,
          isCompleted: t.isCompleted,
          assigneeName: t.assigneeId != null ? (nameById.get(t.assigneeId) ?? null) : null,
        })),
      }
    : null
  const canStartOffboarding =
    canSeeBilling || (detail.manager != null && detail.manager.id === user.id)

  // Projects tab (§20, §6.2): the client's projects plus the engagement
  // flip - admin/owner or the client's manager (the action re-guards).
  const clientProjects = await listProjects({ clientId: id })
  const canManageEngagement =
    canSeeBilling || (detail.manager != null && detail.manager.id === user.id)

  // Recurring tab (§6.4): manager+ manage rules, bookkeepers read-only; the
  // actions re-guard. Assignee select lists every active staff member.
  const canManageRules = ['manager', 'admin', 'owner'].includes(user.normalizedRole)
  const ruleStaffOptions = staffRows
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, name: staffNameOf(u) }))

  const deepTab = ['work', 'recurring', 'billing', 'tax', 'w9', 'offboarding', 'projects', 'properties'].includes(tab ?? '') ? tab : undefined

  return (
    <div className="space-y-5 pb-10">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All clients
      </Link>

      {/* Profile header */}
      <header className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {detail.dbaName ?? detail.legalName}
              </h1>
              <ClientStateChip state={detail.state} size="md" />
            </div>
            {detail.dbaName && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{detail.legalName}</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {cadenceTierLabel(detail.bookkeepingFrequency, detail.monthlyCloseTier)}
              {detail.isProjectEngagement && ' · Project engagement'}
              {detail.isRealEstateClient && ' · Real estate'}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <StaffAvatars manager={detail.manager} bookkeeper={detail.bookkeeper} />
            <dl className="flex gap-6 text-right">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Bookkeeping start
                </dt>
                <dd className="tnum mt-0.5 text-sm font-medium text-foreground">
                  {detail.bookkeepingStartDate ? fullDateLabel(detail.bookkeepingStartDate) : 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Catch-up
                </dt>
                <dd className="tnum mt-0.5 text-sm font-medium text-foreground">
                  {detail.bankFeedCatchupDate ? fullDateLabel(detail.bankFeedCatchupDate) : 'None'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </header>

      <ClientDetailTabs
        detail={detail}
        work={work}
        yearGrid={yearGrid}
        yearGridPrevHref={`/clients/${id}?tab=work&year=${year - 1}`}
        yearGridNextHref={`/clients/${id}?tab=work&year=${year + 1}`}
        billing={billing}
        showBilling={canSeeBilling}
        canEditWorkDay={canEditWorkDay}
        canAssignStaff={canAssignStaff}
        managers={managers}
        bookkeepers={bookkeepers}
        clientInvoices={clientInvoices}
        defaultTab={deepTab === 'billing' && !canSeeBilling ? undefined : deepTab}
        documentsPanel={
          <DocumentsPanel
            clientId={id}
            folders={documentTree.folders}
            documents={documentItems}
            accounts={promoteAccounts}
            canManageStatements={canManage}
          />
        }
        statementsPanel={
          <ClientStatementsPanel
            clientName={detail.dbaName ?? detail.legalName}
            grid={statementsGrid}
            statusByAccount={statusByAccount}
            canUpload={canManage}
          />
        }
        taxPanel={<ClientTaxPanel clientId={id} year={year} items={taxItems} canManage={canManageTax} />}
        w9Panel={<ClientW9Panel clientId={id} year={year} recipients={w9Items} />}
        offboardingPanel={
          <OffboardingPanel
            clientId={id}
            clientName={detail.dbaName ?? detail.legalName}
            clientActive={detail.state !== 'inactive'}
            canStart={canStartOffboarding}
            offboarding={offboarding}
          />
        }
        propertiesPanel={
          detail.isRealEstateClient ? (
            <ClientPropertiesPanel
              clientId={id}
              year={year}
              properties={propertyItems}
              proformaCells={proformaCells}
              proformaRequest={proformaRequest}
              requiredCount={proformaRequiredCount}
              submittedCount={proformaSubmittedCount}
            />
          ) : undefined
        }
        recurringPanel={
          <ClientRecurringPanel
            clientId={id}
            clientName={detail.dbaName ?? detail.legalName}
            rules={clientRules}
            staff={ruleStaffOptions}
            canManage={canManageRules}
            isProjectEngagement={detail.isProjectEngagement}
            defaultAnchorMonth={today.month}
          />
        }
        projectsPanel={
          <ClientProjectsPanel
            clientId={id}
            clientName={detail.dbaName ?? detail.legalName}
            projects={clientProjects}
            isProjectEngagement={detail.isProjectEngagement}
            projectCutoffDate={detail.projectCutoffDate}
            canManageEngagement={canManageEngagement}
          />
        }
      />
    </div>
  )
}

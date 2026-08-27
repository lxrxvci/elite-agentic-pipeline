'use client'

import type { ReactNode } from 'react'
import { DoorOpen, FolderOpen, Landmark, ReceiptText, Repeat, Scale, SquareKanban, Building2 } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ClientBilling, ClientDetail, ClientWork } from '@/server/clients'
import type { ClientYearGrid } from '@/server/year-grid'

import { BillingPanel, type ClientInvoiceRef } from './billing-panel'
import { ClientWorkTab } from './client-work-tab'
import { OnboardingPanel } from './onboarding-panel'
import { OverviewPanel, type StaffOption } from './overview-panel'

/**
 * Client record tab clusters (HANDOFF §10 visibility rules, enforced
 * server-side and reflected here):
 *  - Billing renders only for owner/admin; the page never fetches it
 *    otherwise, so billing data cannot reach an unauthorized payload.
 *  - Properties renders only for real-estate clients.
 *  - Project-engagement clients have no periodic work stream; the Work tab
 *    explains that instead of pretending rows exist.
 * Documents and Statements are live surfaces, passed in as pre-composed
 * panels by the server page (data never crosses unauthorized boundaries).
 * Tax (year-end checklist), W-9/1099, Offboarding, Projects, and
 * Properties (real-estate clients only) are live too, also
 * server-composed.
 */

interface ClientDetailTabsProps {
  detail: ClientDetail
  work: ClientWork
  /** Year progress grid for the Work tab (streams x cadence periods). */
  yearGrid: ClientYearGrid
  /** Year navigation targets for the grid header (deep-link to the Work tab). */
  yearGridPrevHref: string
  yearGridNextHref: string
  /** null unless the caller is owner/admin. */
  billing: ClientBilling | null
  showBilling: boolean
  /** manager/admin/owner may set the client's work day on the Overview tab. */
  canEditWorkDay?: boolean
  /** manager/admin/owner may assign the client's team on the Overview tab. */
  canAssignStaff?: boolean
  /** Active staff options for the Overview tab team selects. */
  managers?: StaffOption[]
  bookkeepers?: StaffOption[]
  /** Recent invoices for the Billing tab sub-section (owner/admin only). */
  clientInvoices?: ClientInvoiceRef[]
  /** Deep-linkable tab (e.g. ?tab=billing for screenshots). */
  defaultTab?: string
  /** Server-composed Documents tab panel. */
  documentsPanel?: ReactNode
  /** Server-composed Statements tab panel. */
  statementsPanel?: ReactNode
  /** Server-composed Year-End Tax tab panel. */
  taxPanel?: ReactNode
  /** Server-composed W-9/1099 tab panel. */
  w9Panel?: ReactNode
  /** Server-composed Offboarding tab panel. */
  offboardingPanel?: ReactNode
  /** Server-composed Projects tab panel. */
  projectsPanel?: ReactNode
  /** Server-composed Recurring rules tab panel. */
  recurringPanel?: ReactNode
  /** Server-composed Properties tab panel (real-estate clients only). */
  propertiesPanel?: ReactNode
}

export function ClientDetailTabs({ detail, work, yearGrid, yearGridPrevHref, yearGridNextHref, billing, showBilling, canEditWorkDay = false, canAssignStaff = false, managers = [], bookkeepers = [], clientInvoices = [], defaultTab, documentsPanel, statementsPanel, taxPanel, w9Panel, offboardingPanel, projectsPanel, recurringPanel, propertiesPanel }: ClientDetailTabsProps) {
  return (
    <Tabs defaultValue={defaultTab ?? 'overview'}>
      <TabsList className="h-9 flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="work">
          Work
          {work.rows.length > 0 && (
            <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{work.rows.length}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="recurring" data-testid="recurring-tab">
          <Repeat className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Recurring
        </TabsTrigger>
        <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
        {showBilling && (
          <TabsTrigger value="billing" data-testid="billing-tab">
            Billing
          </TabsTrigger>
        )}
        <TabsTrigger value="documents" data-testid="documents-tab">
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Documents
        </TabsTrigger>
        <TabsTrigger value="statements" data-testid="statements-tab">
          <Landmark className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Statements
        </TabsTrigger>
        <TabsTrigger value="tax" data-testid="tax-tab">
          <Scale className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Tax
        </TabsTrigger>
        <TabsTrigger value="w9" data-testid="w9-tab">
          <ReceiptText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          W-9/1099
        </TabsTrigger>
        <TabsTrigger value="offboarding" data-testid="offboarding-tab">
          <DoorOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Offboarding
        </TabsTrigger>
        <TabsTrigger value="projects" data-testid="projects-tab">
          <SquareKanban className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Projects
        </TabsTrigger>
        {detail.isRealEstateClient && (
          <TabsTrigger value="properties" data-testid="properties-tab">
            <Building2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Properties
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        <OverviewPanel
          detail={detail}
          canEditWorkDay={canEditWorkDay}
          canAssignStaff={canAssignStaff}
          managers={managers}
          bookkeepers={bookkeepers}
        />
      </TabsContent>
      <TabsContent value="work" className="mt-4">
        <ClientWorkTab
          work={work}
          grid={yearGrid}
          prevYearHref={yearGridPrevHref}
          nextYearHref={yearGridNextHref}
        />
      </TabsContent>
      <TabsContent value="recurring" className="mt-4">
        {recurringPanel}
      </TabsContent>
      <TabsContent value="onboarding" className="mt-4">
        <OnboardingPanel rows={detail.onboarding} today={work.today} />
      </TabsContent>
      {showBilling && billing && (
        <TabsContent value="billing" className="mt-4">
          <BillingPanel billing={billing} clientId={detail.id} invoices={clientInvoices} />
        </TabsContent>
      )}
      <TabsContent value="documents" className="mt-4">
        {documentsPanel}
      </TabsContent>
      <TabsContent value="statements" className="mt-4">
        {statementsPanel}
      </TabsContent>
      <TabsContent value="tax" className="mt-4">
        {taxPanel}
      </TabsContent>
      <TabsContent value="w9" className="mt-4">
        {w9Panel}
      </TabsContent>
      <TabsContent value="offboarding" className="mt-4">
        {offboardingPanel}
      </TabsContent>
      <TabsContent value="projects" className="mt-4">
        {projectsPanel}
      </TabsContent>
      {detail.isRealEstateClient && (
        <TabsContent value="properties" className="mt-4">
          {propertiesPanel}
        </TabsContent>
      )}
    </Tabs>
  )
}

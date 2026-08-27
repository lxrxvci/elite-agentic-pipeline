import { and, desc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { invoices } from "@/db/schema";

import type { SessionUser } from "./auth/guards";
import { requirePortalClientAccess } from "./portal";

/**
 * Portal read-only invoices (HANDOFF §12 "Invoices: read-only list of
 * non-draft invoices").
 *
 * Composition only: membership comes from portal.ts
 * (requirePortalClientAccess - the IDOR guard, run on every call) and the
 * invoice rows from the §15 invoices table. Nothing here mutates; drafts
 * never cross to the portal.
 */

export interface PortalInvoiceItem {
  id: number;
  invoiceNumber: string;
  status: "sent" | "paid" | "overdue" | "void";
  year: number | null;
  month: number | null;
  issueDate: string | null;
  dueDate: string | null;
  total: string;
  sentAt: string | null;
  paidAt: string | null;
}

export async function getPortalInvoices(
  user: SessionUser,
  clientId: number,
): Promise<PortalInvoiceItem[]> {
  const access = await requirePortalClientAccess(user, clientId);

  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, access.clientId), ne(invoices.status, "draft")))
    .orderBy(desc(invoices.year), desc(invoices.month), desc(invoices.id));

  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? `INV-${r.id}`,
    status: r.status as PortalInvoiceItem["status"],
    year: r.year,
    month: r.month,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    total: r.total ?? "0.00",
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
  }));
}

"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireRole } from "@/server/auth/guards";
import { resyncAllBilling, resyncClientBillingFromLiveState, type ResyncAllSummary, type ResyncResult } from "@/server/billing-sync";
import { localToday } from "@/server/dates";
import {
  InvoiceError,
  byEmployeeBillingReport,
  generateMonthlyInvoices,
  getPendingBillableTasks,
  markInvoicePaid,
  markOverdueInvoices,
  quickbooksCsv,
  sendInvoice,
  voidInvoice,
  type EmployeeBillingRow,
  type GenerateSummary,
  type InvoiceRow,
  type MarkOverdueSummary,
  type PendingBillableTask,
} from "@/server/invoices";

import type { ActionResult } from "./documents";

/**
 * Billing and invoicing actions (HANDOFF §6.5/§15). Every money action
 * requires manager or above (§15: the invoice endpoints all require manager
 * or above); mutations revalidate /invoices. Results are typed and
 * human-readable so the UI can toast the reason verbatim.
 */

async function requireManagerUser() {
  try {
    return await requireRole("owner", "admin", "manager");
  } catch {
    return null;
  }
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof InvoiceError) return { ok: false, error: error.message };
  if (error instanceof AuthError) return { ok: false, error: "You do not have permission to do that." };
  return { ok: false, error: fallback };
}

const UNAUTHORIZED = { ok: false as const, error: "You do not have permission to do that." };

function isValidPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
}

// ── Monthly generation and resync (§6.5, §15) ─────────────────────────────

export async function generateMonthlyInvoicesAction(
  year: number,
  month: number,
): Promise<ActionResult<GenerateSummary>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  if (!isValidPeriod(year, month)) {
    return { ok: false, error: "That request was malformed - refresh and try again." };
  }
  try {
    const summary = await generateMonthlyInvoices(year, month, localToday());
    revalidatePath("/invoices");
    return { ok: true, data: summary };
  } catch (error) {
    return failure(error, "Couldn't generate invoices - try again.");
  }
}

export async function resyncClientBillingAction(clientId: number): Promise<ActionResult<ResyncResult>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  if (!Number.isInteger(clientId)) {
    return { ok: false, error: "That request was malformed - refresh and try again." };
  }
  try {
    const result = await resyncClientBillingFromLiveState(clientId, localToday());
    revalidatePath("/invoices");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Couldn't resync billing - try again.");
  }
}

export async function resyncAllBillingAction(): Promise<ActionResult<ResyncAllSummary>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  try {
    const summary = await resyncAllBilling(localToday());
    revalidatePath("/invoices");
    return { ok: true, data: summary };
  } catch (error) {
    return failure(error, "Couldn't resync billing - try again.");
  }
}

// ── Lifecycle (§7: draft / sent / paid / overdue / void) ──────────────────

async function lifecycleAction(
  invoiceId: number,
  mutate: (id: number) => Promise<InvoiceRow>,
  fallback: string,
): Promise<ActionResult<{ invoiceId: number; status: string }>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  if (!Number.isInteger(invoiceId)) {
    return { ok: false, error: "That request was malformed - refresh and try again." };
  }
  try {
    const invoice = await mutate(invoiceId);
    revalidatePath("/invoices");
    return { ok: true, data: { invoiceId: invoice.id, status: invoice.status } };
  } catch (error) {
    return failure(error, fallback);
  }
}

export async function sendInvoiceAction(
  invoiceId: number,
): Promise<ActionResult<{ invoiceId: number; status: string }>> {
  return lifecycleAction(invoiceId, sendInvoice, "Couldn't send the invoice - try again.");
}

export async function markInvoicePaidAction(
  invoiceId: number,
): Promise<ActionResult<{ invoiceId: number; status: string }>> {
  return lifecycleAction(invoiceId, markInvoicePaid, "Couldn't mark the invoice paid - try again.");
}

export async function voidInvoiceAction(
  invoiceId: number,
): Promise<ActionResult<{ invoiceId: number; status: string }>> {
  return lifecycleAction(invoiceId, voidInvoice, "Couldn't void the invoice - try again.");
}

export async function markOverdueInvoicesAction(): Promise<ActionResult<MarkOverdueSummary>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  try {
    const summary = await markOverdueInvoices(localToday());
    revalidatePath("/invoices");
    return { ok: true, data: summary };
  } catch (error) {
    return failure(error, "Couldn't update overdue invoices - try again.");
  }
}

// ── Queues and reports (§15) ──────────────────────────────────────────────

export async function getPendingBillableTasksAction(
  clientId?: number,
): Promise<ActionResult<PendingBillableTask[]>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  try {
    return { ok: true, data: await getPendingBillableTasks(clientId) };
  } catch (error) {
    return failure(error, "Couldn't load the pending billable tasks - try again.");
  }
}

export async function quickbooksCsvAction(invoiceIds: number[]): Promise<ActionResult<string>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  if (!Array.isArray(invoiceIds) || invoiceIds.some((id) => !Number.isInteger(id))) {
    return { ok: false, error: "That request was malformed - refresh and try again." };
  }
  try {
    return { ok: true, data: await quickbooksCsv(invoiceIds) };
  } catch (error) {
    return failure(error, "Couldn't build the QuickBooks export - try again.");
  }
}

export async function byEmployeeBillingReportAction(
  year: number,
  month: number,
): Promise<ActionResult<EmployeeBillingRow[]>> {
  const user = await requireManagerUser();
  if (!user) return UNAUTHORIZED;
  if (!isValidPeriod(year, month)) {
    return { ok: false, error: "That request was malformed - refresh and try again." };
  }
  try {
    return { ok: true, data: await byEmployeeBillingReport(year, month) };
  } catch (error) {
    return failure(error, "Couldn't load the billing report - try again.");
  }
}

import { and, eq } from "drizzle-orm";
import { formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { clientReports } from "@/db/schema";

import { localToday } from "./dates";
import { getDocumentTree, type DocumentRow } from "./documents";
import { requirePortalClientAccess } from "./portal";
import { buildClientYearGrid, type ClientYearGrid } from "./year-grid";
import type { SessionUser } from "./auth/guards";

/**
 * Portal-scoped progress reads (FIRMOS-VISUAL-ELITE-PLAN Wave 4): the
 * client's own year grid and the delivered-reports calendar, exposing the
 * SAME engine truth the staff surfaces render.
 *
 * Scoping rule (§12, §30 conv. 10): every entry point resolves the acting
 * client through the portal engine FIRST (requirePortalClientAccess -
 * membership against the linked-client set on every call) and only then
 * composes the shared engines. Portal pages never touch the db directly;
 * they call these reads. The year-grid engine itself stays guard-free in
 * buildClientYearGrid - authorization lives here, in exactly one place.
 *
 * CPA accounts pass the same membership check for their linked clients and
 * get the same read-only payload (the portal engine's rule for every other
 * read); they are never offered a write path by the surfaces that consume
 * this module.
 */

export async function getPortalYearGrid(
  user: SessionUser,
  clientId: number,
  year: number,
  today: LocalDate = localToday(),
): Promise<ClientYearGrid | null> {
  await requirePortalClientAccess(user, clientId);
  return buildClientYearGrid(clientId, year, today);
}

// ── Delivered-reports calendar ────────────────────────────────────────────

export type PortalReportCellState = "delivered" | "past_due" | "upcoming" | "no_work";

export interface PortalReportDoc {
  id: number;
  fileName: string;
}

export interface PortalReportCell {
  year: number;
  month: number;
  state: PortalReportCellState;
  /** Earliest open due date for the month (past_due/upcoming context). */
  dueDate: string | null;
  docs: PortalReportDoc[];
}

function docPeriod(doc: DocumentRow): { year: number; month: number } {
  if (doc.attributedYear != null && doc.attributedMonth != null) {
    return { year: doc.attributedYear, month: doc.attributedMonth };
  }
  return { year: doc.createdAt.getFullYear(), month: doc.createdAt.getMonth() + 1 };
}

/**
 * The acting client's report year as twelve month cells. Expected months
 * come from client_reports (the same schedule the staff year grid's reports
 * stream scores); delivered evidence is a completed row OR a report document
 * in the period, so downloads already visible to the portal are never lost.
 * States mirror the staff cell language: delivered reads like the on-track
 * cell, an undelivered month past its due date reads behind, everything
 * else stays muted.
 */
export async function getPortalReportsCalendar(
  user: SessionUser,
  clientId: number,
  year: number,
  today: LocalDate = localToday(),
): Promise<PortalReportCell[]> {
  await requirePortalClientAccess(user, clientId);
  const todayStr = formatLocalDate(today);

  const [rows, tree] = await Promise.all([
    db
      .select()
      .from(clientReports)
      .where(and(eq(clientReports.clientId, clientId), eq(clientReports.attributedYear, year))),
    getDocumentTree(clientId),
  ]);

  const docsByMonth = new Map<number, PortalReportDoc[]>();
  for (const doc of tree.documentsByGroup.reports) {
    const period = docPeriod(doc);
    if (period.year !== year) continue;
    const list = docsByMonth.get(period.month) ?? [];
    list.push({ id: doc.id, fileName: doc.fileName });
    docsByMonth.set(period.month, list);
  }

  const cells: PortalReportCell[] = [];
  for (let month = 1; month <= 12; month++) {
    const monthRows = rows.filter((r) => r.attributedMonth === month);
    const docs = (docsByMonth.get(month) ?? []).sort((a, b) => a.fileName.localeCompare(b.fileName));
    const openDueDates = monthRows
      .filter((r) => r.completedAt == null && r.dueDate != null)
      .map((r) => r.dueDate!)
      .sort();
    const delivered = docs.length > 0 || monthRows.some((r) => r.completedAt != null);

    let state: PortalReportCellState;
    if (delivered) {
      state = "delivered";
    } else if (openDueDates.length > 0 && openDueDates[0] < todayStr) {
      state = "past_due";
    } else if (monthRows.length > 0) {
      state = "upcoming";
    } else {
      state = "no_work";
    }

    cells.push({ year, month, state, dueDate: openDueDates[0] ?? null, docs });
  }
  return cells;
}

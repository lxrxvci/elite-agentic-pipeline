import { and, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  clientIntakes,
  clients,
  documents,
  invoices,
  quickNotes,
  tasks,
} from "@/db/schema";
import {
  SEARCH_GROUP_CAP,
  type SearchHit,
  type SearchResults,
} from "@/shared/lib/search";

/**
 * Global search (the cmd+k palette's search spine).
 *
 * One entry point, six groups: clients, intakes, open tasks, invoices,
 * documents, notes. Matching is case-insensitive "contains" (ILIKE); ranking
 * is done in memory after a bounded fetch - prefix matches sort before plain
 * contains matches, then alphabetical. Each group is capped (SEARCH_GROUP_CAP)
 * so the palette stays scannable; the fetch limit is higher so ranking sees
 * the real prefix hits even when many rows merely contain the query.
 *
 * Notes are private by default: the caller's own notes plus firm-wide
 * stickies (client_id IS NULL), mirroring listQuickNotes (§16). Note hits
 * rank by recency rather than prefix - note bodies are prose.
 *
 * The shared contract (types, group keys/labels, caps) lives in
 * src/shared/lib/search.ts so the client palette never imports this module.
 */

export {
  SEARCH_GROUP_CAP,
  SEARCH_GROUP_KEYS,
  SEARCH_GROUP_LABELS,
  searchResultsEmpty,
  type SearchGroupKey,
  type SearchHit,
  type SearchResults,
} from "@/shared/lib/search";

/** Rows fetched per group before in-memory ranking (must exceed the cap). */
const FETCH_LIMIT = 40;

function emptyResults(): SearchResults {
  return { clients: [], intakes: [], tasks: [], invoices: [], documents: [], notes: [] };
}

/** Prefix beats contains; ties break alphabetically (case-insensitive). */
export function rankHits<T extends { title: string }>(rows: T[], query: string, cap: number): T[] {
  const q = query.toLowerCase();
  return rows
    .map((row) => ({ row, prefix: row.title.toLowerCase().startsWith(q) }))
    .sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
      return a.row.title.localeCompare(b.row.title, undefined, { sensitivity: "base" });
    })
    .slice(0, cap)
    .map(({ row }) => row);
}

export async function globalSearch(query: string, userId: number): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) return emptyResults();
  const contains = `%${q}%`;

  const [clientRows, intakeRows, taskRows, invoiceRows, documentRows, noteRows] =
    await Promise.all([
      db
        .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
        .from(clients)
        .where(or(ilike(clients.legalName, contains), ilike(clients.dbaName, contains)))
        .limit(FETCH_LIMIT),
      db
        .select({
          id: clientIntakes.id,
          legalName: clientIntakes.legalName,
          dbaName: clientIntakes.dbaName,
          status: clientIntakes.status,
        })
        .from(clientIntakes)
        .where(or(ilike(clientIntakes.legalName, contains), ilike(clientIntakes.dbaName, contains)))
        .limit(FETCH_LIMIT),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          clientId: tasks.clientId,
          clientName: clients.legalName,
        })
        .from(tasks)
        .leftJoin(clients, eq(tasks.clientId, clients.id))
        .where(
          and(ilike(tasks.title, contains), ne(tasks.status, "completed"), isNull(tasks.deletedAt)),
        )
        .limit(FETCH_LIMIT),
      db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          clientName: clients.legalName,
        })
        .from(invoices)
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(ilike(invoices.invoiceNumber, contains))
        .limit(FETCH_LIMIT),
      db
        .select({
          id: documents.id,
          fileName: documents.fileName,
          clientId: documents.clientId,
          clientName: clients.legalName,
        })
        .from(documents)
        .leftJoin(clients, eq(documents.clientId, clients.id))
        .where(ilike(documents.fileName, contains))
        .limit(FETCH_LIMIT),
      db
        .select({
          id: quickNotes.id,
          body: quickNotes.body,
          clientId: quickNotes.clientId,
          clientName: clients.legalName,
        })
        .from(quickNotes)
        .leftJoin(clients, eq(quickNotes.clientId, clients.id))
        .where(
          and(
            ilike(quickNotes.body, contains),
            or(eq(quickNotes.userId, userId), isNull(quickNotes.clientId)),
          ),
        )
        .orderBy(desc(quickNotes.createdAt))
        .limit(FETCH_LIMIT),
    ]);

  const displayName = (r: { legalName: string; dbaName: string | null }) =>
    r.dbaName && r.dbaName.trim() !== "" ? r.dbaName : r.legalName;

  const clientHits: SearchHit[] = clientRows.map((r) => ({
    id: r.id,
    title: displayName(r),
    subtitle: r.dbaName && r.dbaName.trim() !== "" ? r.legalName : null,
    href: `/clients/${r.id}`,
  }));

  const intakeHits: SearchHit[] = intakeRows.map((r) => ({
    id: r.id,
    title: displayName(r),
    subtitle: `Intake - ${r.status.replace(/_/g, " ")}`,
    href: `/intake/${r.id}`,
  }));

  const taskHits: SearchHit[] = taskRows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.clientName,
    href: r.clientId != null ? `/clients/${r.clientId}?tab=work` : "/workstation",
  }));

  const invoiceHits: SearchHit[] = invoiceRows.map((r) => ({
    id: r.id,
    title: r.invoiceNumber ?? `Invoice #${r.id}`,
    subtitle: r.clientName,
    href: `/invoices/${r.id}`,
  }));

  const documentHits: SearchHit[] = documentRows.map((r) => ({
    id: r.id,
    title: r.fileName,
    subtitle: r.clientName,
    href: r.clientId != null ? `/clients/${r.clientId}?tab=documents` : "/workstation",
  }));

  const noteHits: SearchHit[] = noteRows.map((r) => ({
    id: r.id,
    title: r.body.length > 80 ? `${r.body.slice(0, 80)}…` : r.body,
    subtitle: r.clientName ?? "Firm-wide note",
    href: "/notes",
  }));

  return {
    clients: rankHits(clientHits, q, SEARCH_GROUP_CAP),
    intakes: rankHits(intakeHits, q, SEARCH_GROUP_CAP),
    tasks: rankHits(taskHits, q, SEARCH_GROUP_CAP),
    invoices: rankHits(invoiceHits, q, SEARCH_GROUP_CAP),
    documents: rankHits(documentHits, q, SEARCH_GROUP_CAP),
    notes: noteHits.slice(0, SEARCH_GROUP_CAP),
  };
}

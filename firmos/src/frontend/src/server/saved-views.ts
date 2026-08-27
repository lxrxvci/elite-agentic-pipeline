import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { savedViews } from "@/db/schema";
import type { QueueBucket, WorkCardKind } from "@/server/queue";

/**
 * Saved views - Karbon-style "filter, save, come back", persisted in the
 * saved_views table (the DB swap the workstation's localStorage seam
 * documented). Views are per user, namespaced by `context` ("workstation"
 * today), and unique per (user, context, name) - a duplicate name is a
 * friendly 409, not an overwrite, so a typo never silently clobbers a view.
 *
 * The filter payload is surface-owned; this module validates the workstation
 * shape (bucket/search/kinds/assigneeId/clientId) before anything is stored.
 */

export const SAVED_VIEW_CONTEXTS = ["workstation"] as const;
export type SavedViewContext = (typeof SAVED_VIEW_CONTEXTS)[number];

export type ViewBucketFilter = "all" | QueueBucket;

export interface WorkstationViewFilters {
  bucket: ViewBucketFilter;
  search: string;
  kinds: WorkCardKind[];
  assigneeId: number | null;
  clientId: number | null;
}

export interface SavedViewRecord {
  id: number;
  name: string;
  context: SavedViewContext;
  filters: WorkstationViewFilters;
  position: number;
}

export const MAX_SAVED_VIEWS = 12;

const VALID_BUCKETS: readonly ViewBucketFilter[] = [
  "all",
  "overdue",
  "due_today",
  "upcoming",
  "waiting_on_client",
  "deferred",
  "gated",
];
const VALID_KINDS: readonly WorkCardKind[] = ["task", "bank_feed", "reconciliation", "report"];

export class SavedViewError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "SavedViewError";
  }
}

/** Structural validation for the workstation filter payload. */
export function isWorkstationViewFilters(value: unknown): value is WorkstationViewFilters {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.bucket === "string" &&
    VALID_BUCKETS.includes(v.bucket as ViewBucketFilter) &&
    typeof v.search === "string" &&
    Array.isArray(v.kinds) &&
    v.kinds.every((k) => VALID_KINDS.includes(k as WorkCardKind)) &&
    (typeof v.assigneeId === "number" || v.assigneeId === null) &&
    (typeof v.clientId === "number" || v.clientId === null)
  );
}

function assertContext(context: string): asserts context is SavedViewContext {
  if (!SAVED_VIEW_CONTEXTS.includes(context as SavedViewContext)) {
    throw new SavedViewError(400, `Unknown saved-view context: ${context}`);
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new SavedViewError(400, "Name the view before saving it.");
  if (trimmed.length > 60) throw new SavedViewError(400, "Keep the view name under 60 characters.");
  return trimmed;
}

function toRecord(row: typeof savedViews.$inferSelect): SavedViewRecord {
  // Rows are only ever written after validation, but a hand-edited row should
  // not crash the palette: unknown payloads fall back to the default filters.
  const filters = isWorkstationViewFilters(row.filters)
    ? row.filters
    : { bucket: "all" as const, search: "", kinds: [...VALID_KINDS], assigneeId: null, clientId: null };
  return {
    id: row.id,
    name: row.name,
    context: row.context as SavedViewContext,
    filters,
    position: row.position,
  };
}

export async function listSavedViews(
  userId: number,
  context: SavedViewContext,
): Promise<SavedViewRecord[]> {
  assertContext(context);
  const rows = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.userId, userId), eq(savedViews.context, context)))
    .orderBy(asc(savedViews.position), asc(savedViews.id));
  return rows.map(toRecord);
}

export async function saveSavedView(
  userId: number,
  context: SavedViewContext,
  name: string,
  filters: WorkstationViewFilters,
): Promise<SavedViewRecord> {
  assertContext(context);
  const clean = normalizeName(name);
  if (!isWorkstationViewFilters(filters)) {
    throw new SavedViewError(400, "Those filters could not be saved - adjust them and try again.");
  }

  const existing = await listSavedViews(userId, context);
  if (existing.some((v) => v.name.toLowerCase() === clean.toLowerCase())) {
    throw new SavedViewError(409, `A view named "${clean}" already exists - pick another name.`);
  }
  if (existing.length >= MAX_SAVED_VIEWS) {
    throw new SavedViewError(400, `You can save up to ${MAX_SAVED_VIEWS} views - delete one first.`);
  }

  const position = existing.reduce((max, v) => Math.max(max, v.position), -1) + 1;
  const [row] = await db
    .insert(savedViews)
    .values({ userId, context, name: clean, filters, position })
    .returning();
  return toRecord(row);
}

export async function deleteSavedView(
  userId: number,
  context: SavedViewContext,
  name: string,
): Promise<void> {
  assertContext(context);
  const deleted = await db
    .delete(savedViews)
    .where(
      and(eq(savedViews.userId, userId), eq(savedViews.context, context), eq(savedViews.name, name)),
    )
    .returning({ id: savedViews.id });
  if (deleted.length === 0) {
    throw new SavedViewError(404, `No view named "${name}" - it may already be deleted.`);
  }
}

/**
 * Migrate-on-read backfill (see the workstation's saved-views module): imports
 * a browser's legacy localStorage views ONLY when the user has no DB views in
 * this context yet, so the import runs once and can never overwrite rows the
 * user saved after migrating. Returns the number imported.
 */
export async function importSavedViews(
  userId: number,
  context: SavedViewContext,
  views: { name: string; filters: WorkstationViewFilters }[],
): Promise<number> {
  assertContext(context);
  const existing = await listSavedViews(userId, context);
  if (existing.length > 0) return 0;

  const seen = new Set<string>();
  const rows = views
    .map((v) => ({ name: v.name.trim(), filters: v.filters }))
    .filter((v) => v.name !== "" && isWorkstationViewFilters(v.filters))
    .filter((v) => {
      const key = v.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SAVED_VIEWS);
  if (rows.length === 0) return 0;

  await db
    .insert(savedViews)
    .values(rows.map((v, i) => ({ userId, context, name: v.name, filters: v.filters, position: i })));
  return rows.length;
}

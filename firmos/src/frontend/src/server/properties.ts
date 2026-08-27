import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  clients,
  clientUserAccess,
  contactClientLinks,
  properties,
  propertyProformaRequests,
  propertyProformas,
  users,
} from "@/db/schema";

import type { SessionUser } from "./auth/guards";
import { onPropertyBillingChanged } from "./billing-sync";
import {
  PortalAccessDeniedError,
  PortalError,
  notifyStaff,
  requirePortalClientAccess,
} from "./portal";

import {
  PROFORMA_FIGURE_FIELDS,
  type DepreciationBreakdown,
  type ProformaFigures,
} from "@/shared/lib/proforma";

// Field lists and JSONB shapes are shared with the client panels; re-export
// so server-side callers can keep importing from this engine module.
export { DEPRECIATION_FIELDS, PROFORMA_FIGURE_FIELDS } from "@/shared/lib/proforma";
export type {
  DepreciationBreakdown,
  DepreciationField,
  DepreciationFieldKey,
  ProformaFigureKey,
  ProformaFigures,
} from "@/shared/lib/proforma";

/**
 * Real-estate properties (HANDOFF §20, portal flow §12).
 *
 * Property tracks identity/address, type, sale status, annual financials,
 * mortgage details, a depreciation breakdown with per-field "known" flags
 * (JSONB), the QuickBooks class name, and merchant account details.
 *
 * Billing resync (§15): changes to billing-relevant fields - name, QBO class
 * name, sold status, mortgage balance/lender (billing counts a mortgage from
 * either, see billing-sync.ts) - plus any create/delete fire
 * onPropertyBillingChanged. Field edits that cannot move a price (address,
 * annual revenue, depreciation) do not resync.
 *
 * Pro-forma flow (§12/§20): one property_proformas row per property per
 * year, upserted by staff (from_portal=false) or by the client through the
 * portal (from_portal=true), always recording last_edited_by/at. Staff mint a
 * property_proforma_requests row per client+year, which notifies the
 * client's portal users. Each portal submission re-checks completion: when
 * every NON-SOLD property has a portal-submitted row for the year the
 * pending request auto-completes and the bookkeeper/manager/requester are
 * notified. Sold properties are excluded from the requirement; staff-entered
 * rows never count toward it.
 *
 * Guarding lives in the callers: staff actions use requireStaff
 * (src/server/actions/properties.ts); portal entry points here take the
 * SessionUser and run requirePortalClientAccess (IDOR guard) plus the
 * real-estate-client check on every call.
 */

export class PropertyError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "PropertyError";
  }
}

export type PropertyRow = typeof properties.$inferSelect;
export type PropertyProformaRow = typeof propertyProformas.$inferSelect;
export type ProformaRequestRow = typeof propertyProformaRequests.$inferSelect;

// ── Depreciation breakdown (JSONB with per-field known flags) ─────────────

/** Wire shape accepted by create/update: numbers or numeric strings. */
export type DepreciationInput = Record<
  string,
  { value: number | string | null; known?: boolean } | null | undefined
>;

function sanitizeDepreciation(input: DepreciationInput | null | undefined): DepreciationBreakdown | null {
  if (input == null) return null;
  const out: DepreciationBreakdown = {};
  for (const [key, entry] of Object.entries(input)) {
    if (entry == null) continue;
    const value = entry.value == null || entry.value === "" ? null : Number(entry.value);
    if (value != null && !Number.isFinite(value)) {
      throw new PropertyError(400, `Depreciation value for ${key} must be a number`);
    }
    out[key] = { value, known: entry.known === true };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Read-side normalization: rows written before this module may be looser. */
export function normalizeDepreciation(raw: unknown): DepreciationBreakdown {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DepreciationBreakdown = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as { value?: unknown; known?: unknown };
    const value = e.value == null ? null : Number(e.value);
    out[key] = { value: value != null && Number.isFinite(value) ? value : null, known: e.known === true };
  }
  return out;
}

// ── Pro-forma figures (JSONB; shape owned by the §20 UI) ──────────────────

export type ProformaFiguresInput = Record<string, number | string | null | undefined>;

export function sanitizeFigures(input: ProformaFiguresInput): ProformaFigures {
  const out: ProformaFigures = {};
  for (const key of PROFORMA_FIGURE_FIELDS) {
    const raw = input[key];
    if (raw == null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new PropertyError(400, `Pro forma figure ${key} must be a number`);
    out[key] = value;
  }
  const notes = input.notes;
  if (typeof notes === "string" && notes.trim() !== "") out.notes = notes.trim();
  return out;
}

function assertValidYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new PropertyError(400, "Year must be an integer between 2000 and 2100");
  }
}

function moneyOrNull(value: string | number | null | undefined, field: string): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new PropertyError(400, `${field} must be a number`);
  return n.toFixed(2);
}

// ── CRUD (§20) ────────────────────────────────────────────────────────────

export interface PropertyInput {
  clientId: number;
  name: string;
  propertyType?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  isSold?: boolean;
  soldDate?: string | null;
  salePrice?: string | number | null;
  purchasePrice?: string | number | null;
  purchaseDate?: string | null;
  annualRevenue?: string | number | null;
  annualExpenses?: string | number | null;
  mortgageLender?: string | null;
  mortgageBalance?: string | number | null;
  monthlyMortgagePayment?: string | number | null;
  depreciation?: DepreciationInput | null;
  qboClassName?: string | null;
  merchantAccountId?: number | null;
  merchantProcessor?: string | null;
}

export type PropertyPatch = Partial<Omit<PropertyInput, "clientId">>;

function valuesFromInput(input: PropertyInput | PropertyPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const text = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());
  if (input.name !== undefined) values.name = input.name.trim();
  if (input.propertyType !== undefined) values.propertyType = text(input.propertyType);
  if (input.addressLine1 !== undefined) values.addressLine1 = text(input.addressLine1);
  if (input.addressLine2 !== undefined) values.addressLine2 = text(input.addressLine2);
  if (input.city !== undefined) values.city = text(input.city);
  if (input.state !== undefined) values.state = text(input.state);
  if (input.zip !== undefined) values.zip = text(input.zip);
  if (input.isSold !== undefined) values.isSold = input.isSold;
  if (input.soldDate !== undefined) values.soldDate = input.soldDate || null;
  if (input.salePrice !== undefined) values.salePrice = moneyOrNull(input.salePrice, "Sale price");
  if (input.purchasePrice !== undefined) values.purchasePrice = moneyOrNull(input.purchasePrice, "Purchase price");
  if (input.purchaseDate !== undefined) values.purchaseDate = input.purchaseDate || null;
  if (input.annualRevenue !== undefined) values.annualRevenue = moneyOrNull(input.annualRevenue, "Annual revenue");
  if (input.annualExpenses !== undefined) values.annualExpenses = moneyOrNull(input.annualExpenses, "Annual expenses");
  if (input.mortgageLender !== undefined) values.mortgageLender = text(input.mortgageLender);
  if (input.mortgageBalance !== undefined) values.mortgageBalance = moneyOrNull(input.mortgageBalance, "Mortgage balance");
  if (input.monthlyMortgagePayment !== undefined) {
    values.monthlyMortgagePayment = moneyOrNull(input.monthlyMortgagePayment, "Monthly mortgage payment");
  }
  if (input.depreciation !== undefined) values.depreciation = sanitizeDepreciation(input.depreciation);
  if (input.qboClassName !== undefined) values.qboClassName = text(input.qboClassName);
  if (input.merchantAccountId !== undefined) values.merchantAccountId = input.merchantAccountId ?? null;
  if (input.merchantProcessor !== undefined) values.merchantProcessor = text(input.merchantProcessor);
  return values;
}

/** Fields whose change can move a price (§15 resync triggers, §20). */
function billingRelevantChange(before: PropertyRow, after: PropertyRow): boolean {
  return (
    before.name !== after.name ||
    before.qboClassName !== after.qboClassName ||
    before.isSold !== after.isSold ||
    before.mortgageBalance !== after.mortgageBalance ||
    before.mortgageLender !== after.mortgageLender
  );
}

async function requireRealEstateClient(clientId: number): Promise<typeof clients.$inferSelect> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new PropertyError(404, `Client ${clientId} not found`);
  if (!client.isRealEstateClient) {
    throw new PropertyError(400, "Properties are only available for real-estate clients");
  }
  return client;
}

export async function getClientProperties(clientId: number): Promise<PropertyRow[]> {
  return db
    .select()
    .from(properties)
    .where(eq(properties.clientId, clientId))
    .orderBy(asc(properties.isSold), asc(properties.name), asc(properties.id));
}

export async function createProperty(_userId: number, input: PropertyInput): Promise<PropertyRow> {
  await requireRealEstateClient(input.clientId);
  if (input.name.trim() === "") throw new PropertyError(400, "Property name must not be empty");

  const [row] = await db
    .insert(properties)
    .values({ clientId: input.clientId, ...valuesFromInput(input) } as typeof properties.$inferInsert)
    .returning();

  // Create is always a resync trigger (§15).
  await onPropertyBillingChanged(input.clientId);
  return row;
}

export async function updateProperty(
  _userId: number,
  propertyId: number,
  patch: PropertyPatch,
): Promise<PropertyRow> {
  const [before] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!before) throw new PropertyError(404, `Property ${propertyId} not found`);
  if (patch.name !== undefined && patch.name.trim() === "") {
    throw new PropertyError(400, "Property name must not be empty");
  }

  const values = valuesFromInput(patch);
  if (Object.keys(values).length === 0) return before;
  const [after] = await db
    .update(properties)
    .set(values)
    .where(eq(properties.id, propertyId))
    .returning();

  if (billingRelevantChange(before, after)) {
    await onPropertyBillingChanged(before.clientId);
  }
  return after;
}

export async function deleteProperty(_userId: number, propertyId: number): Promise<void> {
  const [row] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!row) throw new PropertyError(404, `Property ${propertyId} not found`);
  await db.delete(properties).where(eq(properties.id, propertyId));
  // Delete is always a resync trigger (§15: the live-derivable line falls out).
  await onPropertyBillingChanged(row.clientId);
}

// ── Pro-forma rows (§20) ──────────────────────────────────────────────────

async function requireProperty(propertyId: number): Promise<PropertyRow> {
  const [row] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!row) throw new PropertyError(404, `Property ${propertyId} not found`);
  return row;
}

async function upsertProformaRow(
  propertyId: number,
  year: number,
  figures: ProformaFigures,
  editedById: number,
  fromPortal: boolean,
  now: Date,
): Promise<PropertyProformaRow> {
  const [row] = await db
    .insert(propertyProformas)
    .values({
      propertyId,
      year,
      figures,
      lastEditedById: editedById,
      lastEditedAt: now,
      fromPortal,
    })
    .onConflictDoUpdate({
      target: [propertyProformas.propertyId, propertyProformas.year],
      set: { figures, lastEditedById: editedById, lastEditedAt: now, fromPortal, updatedAt: now },
    })
    .returning();
  return row;
}

/** Staff entry - never counts toward the portal auto-completion rule. */
export async function upsertStaffProforma(
  staffId: number,
  propertyId: number,
  year: number,
  figuresInput: ProformaFiguresInput,
  now: Date = new Date(),
): Promise<PropertyProformaRow> {
  assertValidYear(year);
  await requireProperty(propertyId);
  return upsertProformaRow(propertyId, year, sanitizeFigures(figuresInput), staffId, false, now);
}

// ── Pro-forma requests + portal submission (§12/§20) ──────────────────────

/** Active portal-role users linked to the client (access rows or contact links). */
async function portalUserIdsFor(clientId: number): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        sql`lower(${users.role}::text) in ('client', 'cpa')`,
        sql`(
          exists (select 1 from ${clientUserAccess} cua
                  where cua.user_id = ${users.id} and cua.client_id = ${clientId})
          or exists (select 1 from ${contactClientLinks} ccl
                     where ccl.contact_id = ${users.contactId} and ccl.client_id = ${clientId})
          or ${users.contactId} = (select cpa_contact_id from ${clients} where id = ${clientId})
        )`,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * §20 - staff request for pro-forma completion. Idempotent per client+year:
 * an existing pending request is returned without re-notifying. Notifies the
 * client's portal users so the request cannot sit unnoticed.
 */
export async function createProformaRequest(
  clientId: number,
  year: number,
  staffId: number,
  now: Date = new Date(),
): Promise<{ request: ProformaRequestRow; created: boolean }> {
  assertValidYear(year);
  const client = await requireRealEstateClient(clientId);

  const [existing] = await db
    .select()
    .from(propertyProformaRequests)
    .where(
      and(
        eq(propertyProformaRequests.clientId, clientId),
        eq(propertyProformaRequests.year, year),
        eq(propertyProformaRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) return { request: existing, created: false };

  const [request] = await db
    .insert(propertyProformaRequests)
    .values({ clientId, year, requestedById: staffId })
    .returning();

  const clientName = client.dbaName ?? client.legalName;
  const portalUserIds = await portalUserIdsFor(clientId);
  if (portalUserIds.length > 0) {
    await notifyStaff({
      userIds: portalUserIds,
      notificationType: "proforma_request",
      title: `${clientName}: pro formas requested for ${year}`,
      message: "Your firm requested pro-forma figures for your properties. Enter them per property from the Properties page.",
      link: "/portal/properties",
      entityType: "property_proforma_request",
      entityId: request.id,
    });
  }
  return { request, created: true };
}

/**
 * §20 auto-completion: when every non-sold property has a portal-submitted
 * row for the year, complete the pending request(s) and notify the
 * bookkeeper, manager, and requester. Staff-entered rows do not count.
 */
async function maybeAutoCompleteProformaRequest(
  clientId: number,
  year: number,
  now: Date,
): Promise<boolean> {
  const pending = await db
    .select()
    .from(propertyProformaRequests)
    .where(
      and(
        eq(propertyProformaRequests.clientId, clientId),
        eq(propertyProformaRequests.year, year),
        eq(propertyProformaRequests.status, "pending"),
      ),
    );
  if (pending.length === 0) return false;

  const clientProperties = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.clientId, clientId), eq(properties.isSold, false)));
  const requiredIds = clientProperties.map((p) => p.id);
  if (requiredIds.length === 0) return false;

  const portalRows = await db
    .select({ propertyId: propertyProformas.propertyId })
    .from(propertyProformas)
    .where(
      and(
        inArray(propertyProformas.propertyId, requiredIds),
        eq(propertyProformas.year, year),
        eq(propertyProformas.fromPortal, true),
      ),
    );
  const submitted = new Set(portalRows.map((r) => r.propertyId));
  if (!requiredIds.every((id) => submitted.has(id))) return false;

  await db
    .update(propertyProformaRequests)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(propertyProformaRequests.clientId, clientId),
        eq(propertyProformaRequests.year, year),
        eq(propertyProformaRequests.status, "pending"),
      ),
    );

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  const clientName = client ? (client.dbaName ?? client.legalName) : `Client ${clientId}`;
  await notifyStaff({
    userIds: [
      client?.bookkeeperId ?? null,
      client?.managerId ?? null,
      ...pending.map((r) => r.requestedById),
    ].filter((v): v is number => v != null),
    notificationType: "proforma_completed",
    title: `${clientName}: ${year} pro formas complete`,
    message: "Every active property now has a portal-submitted pro forma for the year.",
    link: `/clients/${clientId}?tab=properties&year=${year}`,
    entityType: "property_proforma_request",
    entityId: pending[0].id,
  });
  return true;
}

/**
 * §12/§20 - portal-side pro-forma upsert. Membership is validated against
 * the caller's linked-client set on every call (IDOR guard), the client must
 * be a real-estate client, and the property must belong to that client. The
 * submission re-runs the auto-completion check.
 */
export async function submitPortalProforma(
  user: SessionUser,
  clientId: number,
  propertyId: number,
  year: number,
  figuresInput: ProformaFiguresInput,
  now: Date = new Date(),
): Promise<{ proforma: PropertyProformaRow; requestCompleted: boolean }> {
  await requirePortalClientAccess(user, clientId);
  assertValidYear(year);

  const [client] = await db
    .select({ id: clients.id, isRealEstateClient: clients.isRealEstateClient })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new PortalAccessDeniedError();
  if (!client.isRealEstateClient) {
    throw new PortalError(403, "Pro formas are only available for real-estate clients");
  }

  const property = await requireProperty(propertyId);
  if (property.clientId !== clientId) {
    throw new PortalError(404, "Property not found for this client");
  }

  const proforma = await upsertProformaRow(
    propertyId,
    year,
    sanitizeFigures(figuresInput),
    user.id,
    true,
    now,
  );
  const requestCompleted = await maybeAutoCompleteProformaRequest(clientId, year, now);
  return { proforma, requestCompleted };
}

// ── Status reads (§20 grid + portal banner) ───────────────────────────────

export type ProformaCellStatus = "portal_submitted" | "staff_entered" | "missing" | "sold_excluded";

export interface ProformaCell {
  propertyId: number;
  propertyName: string;
  isSold: boolean;
  status: ProformaCellStatus;
  proforma: {
    id: number;
    figures: ProformaFigures;
    fromPortal: boolean;
    lastEditedById: number | null;
    lastEditedAt: string | null;
  } | null;
}

export interface ProformaRequestSummary {
  id: number;
  year: number;
  status: "pending" | "completed" | "cancelled";
  requestedById: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ProformaStatus {
  year: number;
  /** Latest request for the client+year, if any. */
  request: ProformaRequestSummary | null;
  cells: ProformaCell[];
  /** Non-sold properties the auto-completion rule requires. */
  requiredCount: number;
  /** Non-sold properties with a portal-submitted row. */
  submittedCount: number;
}

/**
 * §20 - the property x year grid state. Cell status: a sold property with no
 * row is "sold_excluded" (out of the requirement); a row submitted through
 * the portal beats a staff-entered one.
 */
export async function getProformaStatus(clientId: number, year: number): Promise<ProformaStatus> {
  const [propertyRows, proformaRows, requestRows] = await Promise.all([
    db
      .select()
      .from(properties)
      .where(eq(properties.clientId, clientId))
      .orderBy(asc(properties.isSold), asc(properties.name), asc(properties.id)),
    db
      .select()
      .from(propertyProformas)
      .innerJoin(properties, eq(properties.id, propertyProformas.propertyId))
      .where(and(eq(properties.clientId, clientId), eq(propertyProformas.year, year))),
    db
      .select()
      .from(propertyProformaRequests)
      .where(and(eq(propertyProformaRequests.clientId, clientId), eq(propertyProformaRequests.year, year)))
      .orderBy(desc(propertyProformaRequests.id))
      .limit(1),
  ]);

  const proformaByProperty = new Map(proformaRows.map((r) => [r.property_proformas.propertyId, r.property_proformas]));

  const cells: ProformaCell[] = propertyRows.map((p) => {
    const row = proformaByProperty.get(p.id) ?? null;
    const status: ProformaCellStatus = row
      ? row.fromPortal
        ? "portal_submitted"
        : "staff_entered"
      : p.isSold
        ? "sold_excluded"
        : "missing";
    return {
      propertyId: p.id,
      propertyName: p.name,
      isSold: p.isSold,
      status,
      proforma: row
        ? {
            id: row.id,
            figures: (row.figures ?? {}) as ProformaFigures,
            fromPortal: row.fromPortal,
            lastEditedById: row.lastEditedById,
            lastEditedAt: row.lastEditedAt ? row.lastEditedAt.toISOString() : null,
          }
        : null,
    };
  });

  const request = requestRows[0] ?? null;
  return {
    year,
    request: request
      ? {
          id: request.id,
          year: request.year,
          status: request.status,
          requestedById: request.requestedById,
          createdAt: request.createdAt.toISOString(),
          completedAt: request.completedAt ? request.completedAt.toISOString() : null,
        }
      : null,
    cells,
    requiredCount: cells.filter((c) => !c.isSold).length,
    submittedCount: cells.filter((c) => !c.isSold && c.status === "portal_submitted").length,
  };
}

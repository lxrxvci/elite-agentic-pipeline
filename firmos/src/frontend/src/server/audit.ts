import { db } from "@/db";
import { auditEvents } from "@/db/schema";

/**
 * Append-only audit writer (HANDOFF §11). audit_events has no update or
 * delete path by design - every mutation elsewhere in the system writes a
 * row here so the purge of a client graph still leaves a trail.
 *
 * `metadata` lands in the details jsonb column. Pass a transaction handle
 * when the event must commit or roll back with the mutation it records
 * (e.g. the purge approval writing its final event inside the delete
 * transaction).
 */

export type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

export interface AuditEventInput {
  userId?: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function logEvent(input: AuditEventInput, tx?: DbOrTx): Promise<void> {
  await (tx ?? db).insert(auditEvents).values({
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    details: input.metadata ?? null,
  });
}

/**
 * FirmOS database schema - 64 tables across 15 domain groups, modeled
 * up front from HANDOFF §7 (ADR-0005). Single tenant: no tenant_id/org_id
 * anywhere.
 *
 * Group inventory (table counts):
 *   users.ts          users & access (4)
 *   clients.ts        clients & contacts (12)
 *   accounts.ts       accounts & properties (6)
 *   tasks.ts          tasks & templates (14)
 *   periodic.ts       periodic work (3) - account_reconciliations lives in accounts.ts
 *   documents.ts      documents (2)
 *   intake-transcripts.ts call-notes transcripts for AI intake autofill (1)
 *   projects.ts       projects (4)
 *   billing.ts        billing (3)
 *   tax.ts            tax & compliance (3)
 *   time.ts           time tracking (3)
 *   communications.ts communications & notifications (6)
 *   admin.ts          admin, audit & settings (4)
 *   saved-views.ts    per-user saved views (1)
 *   vault.ts          client credential vault (2) - Phase 3B
 *   meetings.ts       meetings (1) - Phase 3C
 */
export * from "./enums";
export * from "./shared";
export * from "./users";
export * from "./auth";
export * from "./clients";
export * from "./accounts";
export * from "./tasks";
export * from "./periodic";
export * from "./documents";
export * from "./intake-transcripts";
export * from "./projects";
export * from "./billing";
export * from "./tax";
export * from "./time";
export * from "./communications";
export * from "./admin";
export * from "./saved-views";
export * from "./vault";
export * from "./meetings";

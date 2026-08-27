/**
 * @firmos/domain - FirmOS domain core.
 *
 * Pure, dependency-free port of Yecny Bookkeeping OS's hardest-won rules
 * (HANDOFF §§6, 15, 21, 30, 32). Every constant cites its source section.
 * No DB, no ORM, no I/O, no clock: all "today" values are parameters
 * (HANDOFF §30 convention 4). Duck-typed inputs throughout, so any route,
 * job, or script can use these without circular imports.
 *
 * Modules:
 *  - dates.ts           firm-local calendar-day primitives (§30 convention 4)
 *  - attribution.ts     RULE 1 statement rule + RULE 2 work-item rule (§6.1)
 *  - client-state.ts    the four work states and eligibility predicates (§6.2)
 *  - work-item-state.ts completion transition, sync dispatch, due dates (§6.3)
 *  - recurring.ts       schedule math, billing quantities, gating (§6.4)
 *  - time.ts            wall-clock interval union/subtraction (§6.6)
 *  - commission.ts      on-time tiers, semi-monthly payroll, payout (§6.6/§15)
 *  - health.ts          client health scoring (§21)
 *  - quote.ts           PRICING table + calculate_quote (§15)
 *  - billing.ts         template renormalization, February-billed, per-account (§6.5)
 */

export * from "./dates.ts";
export * from "./attribution.ts";
export * from "./client-state.ts";
export * from "./work-item-state.ts";
export * from "./recurring.ts";
export * from "./time.ts";
export * from "./commission.ts";
export * from "./health.ts";
export * from "./quote.ts";
export * from "./billing.ts";

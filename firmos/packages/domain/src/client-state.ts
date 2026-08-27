/**
 * @firmos/domain - client work state (HANDOFF §6.2, client_state.py).
 *
 * Three flags produce four states, checked in precedence order:
 * inactive → paused → project_only → active. Duck-typed client input so any
 * route or job can use these without a database (HANDOFF §30 convention 2:
 * never write is_paused / is_active checks inline).
 */

export type ClientWorkState = "inactive" | "paused" | "project_only" | "active";

/** Duck-typed client flags (HANDOFF §7 Client lifecycle field group). */
export interface ClientFlags {
  is_active?: boolean | null;
  is_paused?: boolean | null;
  is_project_engagement?: boolean | null;
}

/** client_state.py:53 - the four states in precedence order. */
export function clientWorkState(client: ClientFlags): ClientWorkState {
  if (client.is_active === false) return "inactive"; // archived / offboarded. Gone.
  if (client.is_paused === true) return "paused"; // deliberate hold
  if (client.is_project_engagement === true) return "project_only"; // consulting / catch-up
  return "active";
}

/**
 * client_state.py:72 - paused or inactive. Nothing is due, overdue,
 * alertable, or scored. Pausing is a deliberate business decision, not a
 * failure, and must not punish the client's health score (HANDOFF §5).
 */
export function isOnHold(client: ClientFlags): boolean {
  const state = clientWorkState(client);
  return state === "inactive" || state === "paused";
}

/** client_state.py:77 - active only. Gates recurring rules, bank feeds, reconciliations, report rows. */
export function generatesRecurringWork(client: ClientFlags): boolean {
  return clientWorkState(client) === "active";
}

/**
 * client_state.py:86 - not on hold; project-only COUNTS IN. Gates health
 * scores, reports, overdue alerts.
 *
 * The naming carries intent (HANDOFF §6.2): countsForScoring deliberately
 * includes project-only clients while generatesRecurringWork excludes them.
 */
export function countsForScoring(client: ClientFlags): boolean {
  return !isOnHold(client);
}

/**
 * client_state.py:96 - always true, EXCEPT project-only clients with no
 * active project. The Python original queries the database for a
 * pending/in-progress project (client_state.py:38); here the caller passes
 * that verdict in, keeping the module pure.
 */
export function needsStatements(client: ClientFlags, hasActiveProject: boolean): boolean {
  if (clientWorkState(client) === "project_only") return hasActiveProject;
  return true;
}

/** client_state.py:130 - a human-readable skip reason, or null when the client generates work. */
export function assertGeneratesWork(client: ClientFlags): string | null {
  switch (clientWorkState(client)) {
    case "inactive":
      return "client is inactive (archived/offboarded)";
    case "paused":
      return "client is paused";
    case "project_only":
      return "client is a project engagement (no recurring work)";
    default:
      return null;
  }
}

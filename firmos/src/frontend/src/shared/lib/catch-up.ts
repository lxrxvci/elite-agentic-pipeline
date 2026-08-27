/**
 * Catch-up name heuristic (HANDOFF §20): project names that suggest
 * catch-up bookkeeping gate the auto-generation option. Shared between the
 * engine (src/server/projects.ts) and the new-project dialog so the UI
 * offer and the server check can never drift apart.
 */
export const CATCH_UP_NAME_PATTERN = /catch[\s-]?up|retro/i

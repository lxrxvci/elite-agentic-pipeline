/**
 * Global-search contract shared between the server engine
 * (src/server/search.ts) and the command palette (client). Types, group
 * order/labels, and the emptiness check live here so the client bundle never
 * imports the DB-backed engine.
 */

export const SEARCH_GROUP_CAP = 6;

export type SearchGroupKey = "clients" | "intakes" | "tasks" | "invoices" | "documents" | "notes";

export interface SearchHit {
  id: number;
  /** Primary line, e.g. client name or task title. */
  title: string;
  /** Muted secondary line, e.g. the owning client's name. */
  subtitle: string | null;
  href: string;
}

export type SearchResults = Record<SearchGroupKey, SearchHit[]>;

export const SEARCH_GROUP_KEYS: readonly SearchGroupKey[] = [
  "clients",
  "intakes",
  "tasks",
  "invoices",
  "documents",
  "notes",
];

export const SEARCH_GROUP_LABELS: Record<SearchGroupKey, string> = {
  clients: "Clients",
  intakes: "Intakes",
  tasks: "Tasks",
  invoices: "Invoices",
  documents: "Documents",
  notes: "Notes",
};

/** True when every group is empty (drives the palette's no-results state). */
export function searchResultsEmpty(results: SearchResults): boolean {
  return SEARCH_GROUP_KEYS.every((key) => results[key].length === 0);
}

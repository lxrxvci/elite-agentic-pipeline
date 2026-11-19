import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clients, contactClientLinks, contacts } from "@/db/schema";
import type { ContactChannelLink } from "@/shared/lib/contact-channels";

/**
 * Contact + client browse/search lookup (meeting #3, C5/C6/C7): the intake's
 * contact pickers search the WHOLE contact database plus client names, so a
 * person who already exists - on another client's books, or as a CPA on file
 * - gets linked, never re-entered ("clients owning multiple businesses must
 * never create a second contact"). An empty query returns the alphabetical
 * browse page; typed queries use case-insensitive "contains" matching.
 */

export interface ContactLookupHit {
  kind: "contact";
  id: number;
  /** Display name (entity name or "First Last"). */
  name: string;
  firstName: string | null;
  lastName: string | null;
  entityName: string | null;
  email: string | null;
  phone: string | null;
  emails?: string[];
  phones?: string[];
  channels?: ContactChannelLink[];
}

export interface ClientLookupHit {
  kind: "client";
  id: number;
  /** Display name (DBA preferred, else legal). */
  name: string;
}

export interface ContactLookupResults {
  contacts: ContactLookupHit[];
  clients: ClientLookupHit[];
}

/** Per-group cap keeps the picker scannable. */
const LOOKUP_CAP = 20;

const fold = (v: string | null | undefined): string =>
  (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Display name for a contact row: entity name or "First Last". */
export function contactDisplayName(c: {
  firstName?: string | null;
  lastName?: string | null;
  entityName?: string | null;
}): string {
  return (c.entityName ?? [c.firstName, c.lastName].filter(Boolean).join(" ")).trim();
}

/**
 * Normalized identity key for dedup (C4): folded name + folded email. Used
 * by conversion's link-instead-of-create rule - a match requires BOTH name
 * and email, so a bare name collision ("Wren") never merges two people.
 */
export function contactIdentityKey(name: string, email: string | null | undefined): string | null {
  const n = fold(name);
  const e = fold(email);
  if (n === "" || e === "") return null;
  return `${n}|${e}`;
}

export async function searchContactsAndClients(query: string, associationContactId?: number | null): Promise<ContactLookupResults> {
  const q = query.trim().replace(/\s+/g, " ");
  const pattern = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

  const contactRows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      entityName: contacts.entityName,
      email: contacts.email,
      phone: contacts.phone,
      emails: contacts.emails,
      phones: contacts.phones,
      contactChannelLinks: contacts.contactChannelLinks,
    })
    .from(contacts)
    .where(
      q === ""
        ? undefined
        : or(
            ilike(contacts.entityName, pattern),
            ilike(contacts.email, pattern),
            ilike(contacts.phone, pattern),
            sql`coalesce(${contacts.emails}::text, '') ilike ${pattern}`,
            sql`coalesce(${contacts.phones}::text, '') ilike ${pattern}`,
            sql`coalesce(${contacts.contactChannelLinks}::text, '') ilike ${pattern}`,
            sql`btrim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})) ilike ${pattern}`,
            sql`btrim(concat_ws(' ', ${contacts.lastName}, ${contacts.firstName})) ilike ${pattern}`,
          ),
    )
    .orderBy(asc(contacts.entityName), asc(contacts.firstName), asc(contacts.lastName))
    .limit(LOOKUP_CAP * 2);

  const clientFilter = q === "" ? undefined : or(ilike(clients.legalName, pattern), ilike(clients.dbaName, pattern));
  const clientRows = associationContactId === null ? [] : associationContactId == null
    ? await db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(clients)
      .where(clientFilter)
      .orderBy(asc(clients.legalName))
      .limit(LOOKUP_CAP * 2)
    : await db
      .select({ id: clients.id, legalName: clients.legalName, dbaName: clients.dbaName })
      .from(contactClientLinks)
      .innerJoin(clients, eq(clients.id, contactClientLinks.clientId))
      .where(and(eq(contactClientLinks.contactId, associationContactId), clientFilter))
      .orderBy(asc(clients.legalName))
      .limit(LOOKUP_CAP * 2);

  const rank = (name: string): number => (fold(name).startsWith(fold(q)) ? 0 : 1);
  const contactHits = contactRows
    .map((c): ContactLookupHit => ({ kind: "contact", ...c, emails: c.emails ?? [], phones: c.phones ?? [], channels: c.contactChannelLinks ?? [], name: contactDisplayName(c) }))
    .filter((c) => c.name !== "")
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .slice(0, LOOKUP_CAP);
  const clientHits = clientRows
    .map((c): ClientLookupHit => ({ kind: "client", id: c.id, name: c.dbaName ?? c.legalName }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .slice(0, LOOKUP_CAP);

  return { contacts: contactHits, clients: clientHits };
}

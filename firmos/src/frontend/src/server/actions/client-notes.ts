"use server";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientNotes, users } from "@/db/schema";
import { logEvent } from "@/server/audit";
import { requireStaff } from "@/server/auth/guards";

/**
 * K7 (C9 tail + V18, 09_30 00:25:18): the client record's notes surface -
 * the intake's internal + running notes land here at conversion and were
 * write-only until now. Read + add + inline edit, audited.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientNoteItem {
  id: number;
  body: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function listClientNotesAction(clientId: number): Promise<ActionResult<ClientNoteItem[]>> {
  try {
    await requireStaff();
    const rows = await db
      .select({
        id: clientNotes.id,
        body: clientNotes.body,
        createdAt: clientNotes.createdAt,
        updatedAt: clientNotes.updatedAt,
        authorFirst: users.firstName,
        authorLast: users.lastName,
      })
      .from(clientNotes)
      .leftJoin(users, eq(clientNotes.authorId, users.id))
      .where(eq(clientNotes.clientId, clientId))
      .orderBy(asc(clientNotes.createdAt));
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        body: r.body,
        authorName: [r.authorFirst, r.authorLast].filter(Boolean).join(" ") || null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function addClientNoteAction(clientId: number, body: string): Promise<ActionResult<{ id: number }>> {
  try {
    const user = await requireStaff();
    const text = body.trim();
    if (text === "") return { ok: false, error: "Write the note first." };
    const [row] = await db
      .insert(clientNotes)
      .values({ clientId, authorId: user.id, body: text })
      .returning({ id: clientNotes.id });
    await logEvent({ userId: user.id, action: "client_note_added", entityType: "client_note", entityId: row.id, metadata: { clientId } });
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function editClientNoteAction(noteId: number, body: string): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requireStaff();
    const text = body.trim();
    if (text === "") return { ok: false, error: "Write the note first." };
    await db.update(clientNotes).set({ body: text, updatedAt: new Date() }).where(eq(clientNotes.id, noteId));
    await logEvent({ userId: user.id, action: "client_note_edited", entityType: "client_note", entityId: noteId });
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}

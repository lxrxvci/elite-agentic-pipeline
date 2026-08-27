import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, documents, quickNotes, tasks, users } from "@/db/schema";
import { globalSearchAction } from "@/server/actions/search";
import { addQuickNote } from "@/server/quick-add";
import { globalSearch, rankHits, SEARCH_GROUP_CAP, searchResultsEmpty } from "@/server/search";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const OWNER = "mara@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

describe("rankHits (pure ranking)", () => {
  it("sorts prefix matches before contains matches, ties alphabetical", () => {
    const rows = [
      { title: "JJ Harbor Hauling" },
      { title: "harborline Marine" },
      { title: "Alpha Harbor" },
      { title: "Harbor A-1" },
    ];
    const ranked = rankHits(rows, "harbor", 10).map((r) => r.title);
    expect(ranked).toEqual(["Harbor A-1", "harborline Marine", "Alpha Harbor", "JJ Harbor Hauling"]);
  });

  it("caps the result list", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ title: `Cap ${i}` }));
    expect(rankHits(rows, "cap", 5)).toHaveLength(5);
  });
});

describe.skipIf(!reachable)("globalSearch engine", () => {
  let maraId: number;
  let danaId: number;
  let capClientId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    maraId = await userIdByEmail(OWNER);
    danaId = await userIdByEmail(MANAGER);

    // Controlled rows for ranking/cap assertions.
    const [capBase] = await db
      .insert(clients)
      .values({ legalName: "Searchcap Base Co" })
      .returning({ id: clients.id });
    capClientId = capBase.id;
    await db
      .insert(clients)
      .values([{ legalName: "Searchcap Client 00" }, { legalName: "Searchcap Client 01" }]);
    await db.insert(clients).values({ legalName: "ZZ Contains Searchcap Deeply" });
    // More prefix hits than the cap, for the capping assertion.
    for (let i = 0; i < SEARCH_GROUP_CAP + 2; i++) {
      await db.insert(clients).values({ legalName: `Capfill Client ${String(i).padStart(2, "0")}` });
    }

    // An open and a completed task with the same distinctive token.
    await db.insert(tasks).values([
      { clientId: capBase.id, title: "Findmetoken open task", status: "new" },
      {
        clientId: capBase.id,
        title: "Findmetoken completed task",
        status: "completed",
        completedAt: new Date(),
      },
    ]);

    await db.insert(documents).values({
      clientId: capBase.id,
      fileName: "findmetoken-statement.pdf",
      storedPath: `Searchcap Base Co/Documents/2026/findmetoken-statement.pdf`,
    });
  });

  it("returns empty groups for blank or one-character queries", async () => {
    expect(searchResultsEmpty(await globalSearch("", maraId))).toBe(true);
    expect(searchResultsEmpty(await globalSearch("  ", maraId))).toBe(true);
    expect(searchResultsEmpty(await globalSearch("h", maraId))).toBe(true);
  });

  it("matches clients by legal name with route links", async () => {
    const results = await globalSearch("harborline", maraId);
    expect(results.clients.length).toBeGreaterThan(0);
    const hit = results.clients[0];
    expect(hit.title.toLowerCase()).toContain("harborline");
    expect(hit.href).toBe(`/clients/${hit.id}`);
  });

  it("matches clients by DBA and ranks prefix before contains", async () => {
    const results = await globalSearch("searchcap", maraId);
    const titles = results.clients.map((h) => h.title);
    // Prefix hits first, alphabetical; the deep-contains client ranks last.
    expect(titles[0]).toBe("Searchcap Base Co");
    expect(titles[titles.length - 1]).toBe("ZZ Contains Searchcap Deeply");
  });

  it("caps each group at SEARCH_GROUP_CAP", async () => {
    const results = await globalSearch("capfill", maraId);
    expect(results.clients).toHaveLength(SEARCH_GROUP_CAP);
    // Alphabetical order within the prefix tier.
    expect(results.clients[0].title).toBe("Capfill Client 00");
  });

  it("matches intakes by name", async () => {
    // The seed's intake shares the legal name with its converted client.
    const results = await globalSearch("Harborline Marine Supply", maraId);
    expect(results.intakes.length).toBeGreaterThan(0);
    expect(results.intakes[0].href).toMatch(/^\/intake\/\d+$/);
  });

  it("matches open tasks by title and excludes completed ones", async () => {
    const results = await globalSearch("findmetoken", maraId);
    const titles = results.tasks.map((h) => h.title);
    expect(titles).toContain("Findmetoken open task");
    expect(titles).not.toContain("Findmetoken completed task");
    expect(results.tasks[0].href).toMatch(/^\/clients\/\d+\?tab=work$/);
  });

  it("matches invoices by number", async () => {
    const results = await globalSearch("INV-2026", maraId);
    expect(results.invoices.length).toBeGreaterThan(0);
    expect(results.invoices[0].title).toContain("INV-2026");
    expect(results.invoices[0].href).toMatch(/^\/invoices\/\d+$/);
  });

  it("matches documents by file name", async () => {
    const results = await globalSearch("findmetoken-statement", maraId);
    expect(results.documents.length).toBe(1);
    expect(results.documents[0].href).toMatch(/^\/clients\/\d+\?tab=documents$/);
  });

  it("scopes notes to the caller's own plus firm-wide stickies", async () => {
    await addQuickNote({ clientId: capClientId, body: "Notescope mara private note" }, maraId);
    await addQuickNote({ clientId: capClientId, body: "Notescope dana private note" }, danaId);
    await addQuickNote({ body: "Notescope firm-wide sticky" }, danaId);

    const maraResults = await globalSearch("notescope", maraId);
    const bodies = maraResults.notes.map((h) => h.title);
    expect(bodies).toContain("Notescope mara private note");
    expect(bodies).toContain("Notescope firm-wide sticky");
    expect(bodies).not.toContain("Notescope dana private note");
    for (const hit of maraResults.notes) expect(hit.href).toBe("/notes");

    // Cleanup so reruns stay deterministic under the notes cap.
    await db.delete(quickNotes).where(eq(quickNotes.body, "Notescope mara private note"));
    await db.delete(quickNotes).where(eq(quickNotes.body, "Notescope dana private note"));
    await db.delete(quickNotes).where(eq(quickNotes.body, "Notescope firm-wide sticky"));
  });

  it("globalSearchAction rejects unauthenticated callers (role guard)", async () => {
    // No request scope in vitest - requireStaff throws 401, mapped to a
    // typed failure rather than a thrown 500.
    const res = await globalSearchAction("harborline");
    expect(res.ok).toBe(false);
  });
});

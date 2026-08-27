import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { savedViews, users } from "@/db/schema";
import {
  deleteSavedView,
  importSavedViews,
  isWorkstationViewFilters,
  listSavedViews,
  MAX_SAVED_VIEWS,
  saveSavedView,
  SavedViewError,
  type WorkstationViewFilters,
} from "@/server/saved-views";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const MANAGER = "dana@blueledgerbooks.com";

const FILTERS: WorkstationViewFilters = {
  bucket: "overdue",
  search: "bank feed",
  kinds: ["bank_feed", "task"],
  assigneeId: null,
  clientId: null,
};

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

let danaId: number;

/** Unique name per test run so reruns against the same DB stay green. */
let seq = 0;
function viewName(base: string): string {
  seq += 1;
  return `${base} ${Date.now()}-${seq}`;
}

describe("isWorkstationViewFilters (payload validation)", () => {
  it("accepts the workstation shape and rejects malformed payloads", () => {
    expect(isWorkstationViewFilters(FILTERS)).toBe(true);
    expect(isWorkstationViewFilters({ ...FILTERS, bucket: "nope" })).toBe(false);
    expect(isWorkstationViewFilters({ ...FILTERS, kinds: ["task", "mystery"] })).toBe(false);
    expect(isWorkstationViewFilters({ ...FILTERS, search: 42 })).toBe(false);
    expect(isWorkstationViewFilters(null)).toBe(false);
  });
});

describe.skipIf(!reachable)("saved-views engine", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    danaId = await userIdByEmail(MANAGER);
  });

  it("saves and lists views in position order (round trip)", async () => {
    const first = await saveSavedView(danaId, "workstation", viewName("Roundtrip A"), FILTERS);
    const second = await saveSavedView(danaId, "workstation", viewName("Roundtrip B"), {
      ...FILTERS,
      bucket: "due_today",
    });

    expect(first.position).toBeLessThan(second.position);
    const views = await listSavedViews(danaId, "workstation");
    const mine = views.filter((v) => v.name.startsWith("Roundtrip"));
    expect(mine.map((v) => v.name)).toEqual([first.name, second.name]);
    expect(mine[0].filters).toEqual(FILTERS);
    expect(mine[0].context).toBe("workstation");
  });

  it("rejects a duplicate name with a friendly 409 (case-insensitive)", async () => {
    const name = viewName("Conflict");
    await saveSavedView(danaId, "workstation", name, FILTERS);
    await expect(
      saveSavedView(danaId, "workstation", name.toUpperCase(), FILTERS),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already exists"),
    });
  });

  it("rejects blank names, overlong names, and invalid filters with 400s", async () => {
    await expect(saveSavedView(danaId, "workstation", "   ", FILTERS)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      saveSavedView(danaId, "workstation", "x".repeat(61), FILTERS),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveSavedView(danaId, "workstation", viewName("Bad filters"), {
        ...FILTERS,
        bucket: "nope",
      } as unknown as WorkstationViewFilters),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveSavedView(danaId, "portal" as never, viewName("Bad context"), FILTERS),
    ).rejects.toBeInstanceOf(SavedViewError);
  });

  it("deletes by name and 404s on a missing view", async () => {
    const name = viewName("Delete me");
    await saveSavedView(danaId, "workstation", name, FILTERS);
    await deleteSavedView(danaId, "workstation", name);
    const views = await listSavedViews(danaId, "workstation");
    expect(views.some((v) => v.name === name)).toBe(false);
    await expect(deleteSavedView(danaId, "workstation", name)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("importSavedViews backfills only when the DB is empty, deduping names", async () => {
    // Fresh user-scoped context is not empty for Dana after the tests above,
    // so exercise the import through a brand-new seeded user.
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    const ownerId = row.id;
    await db.delete(savedViews).where(eq(savedViews.userId, ownerId));

    const imported = await importSavedViews(ownerId, "workstation", [
      { name: "Legacy A", filters: FILTERS },
      { name: "legacy a", filters: FILTERS }, // dupe, case-insensitive: dropped
      { name: "Legacy B", filters: { ...FILTERS, bucket: "gated" } },
    ]);
    expect(imported).toBe(2);
    const views = await listSavedViews(ownerId, "workstation");
    expect(views.map((v) => v.name)).toEqual(["Legacy A", "Legacy B"]);
    expect(views[1].filters.bucket).toBe("gated");

    // Second import no-ops: the DB is no longer empty, so post-migration
    // views can never be clobbered by a stale browser.
    const again = await importSavedViews(ownerId, "workstation", [
      { name: "Should not land", filters: FILTERS },
    ]);
    expect(again).toBe(0);
    expect((await listSavedViews(ownerId, "workstation")).map((v) => v.name)).not.toContain(
      "Should not land",
    );
  });

  it("enforces the per-user cap with a friendly error", async () => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    const ownerId = row.id;
    await db.delete(savedViews).where(eq(savedViews.userId, ownerId));
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) {
      await saveSavedView(ownerId, "workstation", viewName(`Cap ${i}`), FILTERS);
    }
    await expect(
      saveSavedView(ownerId, "workstation", viewName("Cap overflow"), FILTERS),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("up to") });
    await db.delete(savedViews).where(eq(savedViews.userId, ownerId));
  });
});

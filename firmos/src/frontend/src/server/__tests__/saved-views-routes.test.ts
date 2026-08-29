import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { savedViews, users } from "@/db/schema";
import { eq } from "drizzle-orm";

import type { WorkstationViewFilters } from "@/server/saved-views";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * Integration check for the /api/saved-views route handlers (the seam's REST
 * backend): handlers invoked directly with Request objects, requireStaff
 * mocked to a seeded staff user. The engine itself is covered in
 * saved-views.test.ts; this file only proves the HTTP-shaped wiring (envelope
 * shape, query/body parsing, error mapping).
 */

const mockRequireStaff = vi.fn();
vi.mock("@/server/auth/guards", () => ({
  requireStaff: (...args: unknown[]) => mockRequireStaff(...args),
}));

// Imported after the mock registration (vi.mock is hoisted anyway).
import { GET, POST } from "@/app/api/saved-views/route";
import { DELETE } from "@/app/api/saved-views/[name]/route";

const reachable = await dbReachable();

const FILTERS: WorkstationViewFilters = {
  bucket: "overdue",
  search: "bank",
  kinds: ["bank_feed"],
  assigneeId: null,
  clientId: null,
};

const NAME = `Route probe ${Date.now()}`;

function apiUrl(path: string): string {
  return `http://localhost${path}`;
}

async function body(res: Response): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return (await res.json()) as { ok: boolean; data?: unknown; error?: string };
}

describe.skipIf(!reachable)("/api/saved-views route handlers", () => {
  let userId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "dana@blueledgerbooks.com"))
      .limit(1);
    if (!row) throw new Error("seeded user not found");
    userId = row.id;
    mockRequireStaff.mockResolvedValue({ id: userId });
    await db.delete(savedViews).where(eq(savedViews.userId, userId));
  });

  it("rejects unauthenticated callers with an error envelope", async () => {
    mockRequireStaff.mockRejectedValueOnce(new Error("Authentication required"));
    const res = await GET(new Request(apiUrl("/api/saved-views?context=workstation")));
    const parsed = await body(res);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Authentication required");
  });

  it("GET lists, POST saves (and conflicts), DELETE removes - full cycle", async () => {
    const empty = await body(await GET(new Request(apiUrl("/api/saved-views?context=workstation"))));
    expect(empty).toEqual({ ok: true, data: [] });

    const saved = await body(
      await POST(
        new Request(apiUrl("/api/saved-views"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: "workstation", name: NAME, filters: FILTERS }),
        }),
      ),
    );
    expect(saved.ok).toBe(true);
    const record = saved.data as { id: number; name: string; filters: WorkstationViewFilters };
    expect(record.name).toBe(NAME);
    expect(record.filters).toEqual(FILTERS);

    const conflict = await body(
      await POST(
        new Request(apiUrl("/api/saved-views"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: "workstation", name: NAME, filters: FILTERS }),
        }),
      ),
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toContain("already exists");

    // Import no-ops once views exist (server guard for migrate-on-read).
    const imported = await body(
      await POST(
        new Request(apiUrl("/api/saved-views"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "workstation",
            views: [{ name: "Should not land", filters: FILTERS }],
          }),
        }),
      ),
    );
    expect(imported).toEqual({ ok: true, data: { imported: 0 } });

    const deleted = await body(
      await DELETE(
        new Request(apiUrl(`/api/saved-views/${encodeURIComponent(NAME)}?context=workstation`), {
          method: "DELETE",
        }),
        { params: Promise.resolve({ name: encodeURIComponent(NAME) }) },
      ),
    );
    expect(deleted).toEqual({ ok: true, data: { deleted: true } });

    const after = await body(await GET(new Request(apiUrl("/api/saved-views?context=workstation"))));
    expect(after).toEqual({ ok: true, data: [] });
  });
});

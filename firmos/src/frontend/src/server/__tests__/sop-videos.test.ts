import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { auditEvents, sopTemplates, sopVideos } from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  deleteSopVideo,
  getSopVideo,
  isValidSopVideoPath,
  listSopVideos,
  registerSopVideo,
  sopVideoPath,
} from "@/server/sop-videos";
import { __resetStorageForTests } from "@/server/storage";
import { MAX_VIDEO_BYTES, validateVideoUpload, UploadValidationError } from "@/server/uploads";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K2 (meeting 09_30, 01:16:00): the in-house SOP video recorder - validation,
 * registration, audit, and the playback route (auth + Range streaming).
 */

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

describe("video upload validation (the §13 video branch)", () => {
  it("accepts webm and mp4 recordings by magic bytes", () => {
    expect(validateVideoUpload("walkthrough.webm", "video/webm", WEBM).ext).toBe("webm");
    expect(validateVideoUpload("walkthrough.mp4", "video/mp4", MP4).ext).toBe("mp4");
    // Browsers that declare no concrete type still pass on the container.
    expect(validateVideoUpload("walkthrough.webm", "", WEBM).fileName).toBe("walkthrough.webm");
  });

  it("video_upload_rejects_bad_magic_and_executables", () => {
    expect(() => validateVideoUpload("notes.txt", "text/plain", WEBM)).toThrow(UploadValidationError);
    expect(() => validateVideoUpload("walkthrough.webm", "video/webm", MP4)).toThrow(/do not match/);
    expect(() => validateVideoUpload("walkthrough.webm", "video/webm", EXE)).toThrow(/Windows executable/);
    expect(() => validateVideoUpload("walkthrough.mp4", "image/gif", MP4)).toThrow(/cannot be uploaded/);
    expect(() => validateVideoUpload("walkthrough.webm", "video/webm", new Uint8Array(0))).toThrow(/empty/);
    expect(MAX_VIDEO_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe("sop video storage paths", () => {
  it("the path lives under the SOP's prefix and validates strictly", () => {
    const p = sopVideoPath(7, "My Recording #2.webm");
    expect(p).toMatch(/^sop-videos\/7\/\d+-My-Recording-2\.webm$/);
    expect(isValidSopVideoPath(7, p)).toBe(true);
    expect(isValidSopVideoPath(8, p)).toBe(false);
    expect(isValidSopVideoPath(7, "sop-videos/7/../secrets.webm")).toBe(false);
    expect(isValidSopVideoPath(7, "sop-videos/7/x.txt")).toBe(false);
    expect(isValidSopVideoPath(7, "documents/1/report.webm")).toBe(false);
  });
});

const reachable = await dbReachable();

describe.skipIf(!reachable)("sop video registration + playback (DB + local storage)", () => {
  let sopId: number;
  let docsRoot: string;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    docsRoot = mkdtempSync(path.join(tmpdir(), "firmos-sop-videos-"));
    process.env.FIRMOS_DOCS_ROOT = docsRoot;
    __resetStorageForTests();
    const rows = await db
      .insert(sopTemplates)
      .values({ title: "K2 test SOP", content: "1. Do the thing", isActive: true, position: 99 })
      .returning();
    sopId = rows[0].id;
  });

  afterAll(() => {
    delete process.env.FIRMOS_DOCS_ROOT;
    __resetStorageForTests();
    rmSync(docsRoot, { recursive: true, force: true });
  });

  it("registerSopVideo writes the row and the audit event; delete removes both bytes and row", async () => {
    const storedPath = sopVideoPath(sopId, "walkthrough.webm");
    writeFileSync(path.join(docsRoot, "seed.webm"), WEBM); // unrelated file sanity
    const row = await registerSopVideo(
      { sopTemplateId: sopId, title: "  ", storedPath, mimeType: "video/webm", sizeBytes: 1234, durationSecs: 65 },
      1,
    );
    expect(row.title).toBe("SOP walkthrough"); // blank title falls back
    expect(row.sopTemplateId).toBe(sopId);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "sop_video"));
    expect(audit.some((e) => e.action === "sop_video_uploaded" && e.entityId === row.id)).toBe(true);

    const listed = await listSopVideos([sopId]);
    expect(listed.map((v) => v.id)).toContain(row.id);

    // Registration refuses paths outside the SOP prefix.
    await expect(
      registerSopVideo(
        { sopTemplateId: sopId, title: "x", storedPath: "documents/1/evil.webm", mimeType: "video/webm", sizeBytes: 1, durationSecs: null },
        1,
      ),
    ).rejects.toThrow(/not valid/);

    await deleteSopVideo(row.id, 1);
    expect(await getSopVideo(row.id)).toBeNull();
    const auditAfter = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "sop_video"));
    expect(auditAfter.some((e) => e.action === "sop_video_deleted" && e.entityId === row.id)).toBe(true);
  });

  describe("the playback route", () => {
    let GET: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    let videoId: number;
    const staffUser = { id: 1, normalizedRole: "manager" };

    beforeAll(async () => {
      vi.doMock("@/server/auth/guards", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/server/auth/guards")>();
        return { ...actual, getSessionUser: vi.fn(async () => staffUser) };
      });
      ({ GET } = await import("@/app/api/sop-videos/[id]/route"));
      const storedPath = sopVideoPath(sopId, "playback.webm");
      const full = path.join(docsRoot, storedPath);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, WEBM);
      const row = await registerSopVideo(
        { sopTemplateId: sopId, title: "Playback", storedPath, mimeType: "video/webm", sizeBytes: WEBM.length, durationSecs: 3 },
        1,
      );
      videoId = row.id;
    });

    it("video_route_requires_staff_session and streams with Range support", async () => {
      const res = await GET(new Request("http://x/api/sop-videos/999999"), {
        params: Promise.resolve({ id: "999999" }),
      });
      expect(res.status).toBe(404);

      const full = await GET(new Request(`http://x/api/sop-videos/${videoId}`), {
        params: Promise.resolve({ id: String(videoId) }),
      });
      expect(full.status).toBe(200);
      expect(full.headers.get("content-type")).toBe("video/webm");
      expect(full.headers.get("accept-ranges")).toBe("bytes");
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(WEBM);

      const partial = await GET(
        new Request(`http://x/api/sop-videos/${videoId}`, { headers: { range: "bytes=2-5" } }),
        { params: Promise.resolve({ id: String(videoId) }) },
      );
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe(`bytes 2-5/${WEBM.length}`);
      expect(new Uint8Array(await partial.arrayBuffer())).toEqual(WEBM.subarray(2, 6));

      const unsatisfiable = await GET(
        new Request(`http://x/api/sop-videos/${videoId}`, { headers: { range: "bytes=100-200" } }),
        { params: Promise.resolve({ id: String(videoId) }) },
      );
      expect(unsatisfiable.status).toBe(416);
    });
  });
});

describe("playback route auth branches (no staff session, portal roles)", () => {
  // K8 audit closeout: the 401/403 branches were previously code-inspection
  // only - the staff-session mock never exercised them.
  let GET_AUTH: typeof import("@/app/api/sop-videos/[id]/route").GET;
  let sessionUser: { id: number; normalizedRole: string } | null = null;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("@/server/auth/guards", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/server/auth/guards")>();
      return { ...actual, getSessionUser: vi.fn(async () => sessionUser) };
    });
    ({ GET: GET_AUTH } = await import("@/app/api/sop-videos/[id]/route"));
  });

  it("video_route_rejects_anonymous_401_and_portal_roles_403", async () => {
    sessionUser = null;
    const anon = await GET_AUTH(new Request("http://x/api/sop-videos/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(anon.status).toBe(401);

    sessionUser = { id: 9, normalizedRole: "client" };
    const clientRes = await GET_AUTH(new Request("http://x/api/sop-videos/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(clientRes.status).toBe(403);

    sessionUser = { id: 10, normalizedRole: "cpa" };
    const cpaRes = await GET_AUTH(new Request("http://x/api/sop-videos/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(cpaRes.status).toBe(403);
  });
});

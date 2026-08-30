import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Storage drivers (HANDOFF §13). Two implementations behind one interface:
 *
 *  - `local` (default): files under the docs root - FIRMOS_DOCS_ROOT, else
 *    <frontend>/.firmos-docs/ (gitignored). Used in dev and tests.
 *  - `vercel-blob` (prod): @vercel/blob private store, token from
 *    BLOB_READ_WRITE_TOKEN.
 *
 * Selected by FIRMOS_STORAGE_DRIVER (default "local"). All paths are RELATIVE
 * to the docs root; stored_path in the documents table is always relative
 * (schema documents.ts comment, §13). Download security is the absDocPath
 * guard: reject "..", resolve, verify containment under the docs root.
 *
 * NOTE: validation (size/extension/MIME/magic bytes) deliberately does NOT
 * live here - §13 keeps it in the upload layer (src/server/uploads.ts);
 * storage handles path resolution and bytes only.
 */

export class StorageError extends Error {
  constructor(
    public readonly code: "traversal" | "not_found" | "config" | "io",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface StorageDriver {
  /** Store bytes at relPath, creating parent folders. Overwrites. */
  put(relPath: string, bytes: Uint8Array): Promise<void>;
  /** Read bytes at relPath. Throws StorageError("not_found") when absent. */
  get(relPath: string): Promise<Uint8Array>;
  /** Remove relPath. Missing files are not an error. */
  delete(relPath: string): Promise<void>;
  /**
   * A directly usable download URL, or null when the driver has none
   * (local: the API route streams instead).
   */
  signedUrl(relPath: string): Promise<string | null>;
}

// ── Local filesystem driver ───────────────────────────────────────────────

/** Docs root resolution (§13): env first, then the repo-relative default. */
export function docsRoot(): string {
  const fromEnv = process.env.FIRMOS_DOCS_ROOT;
  if (fromEnv && fromEnv.trim() !== "") return path.resolve(fromEnv);
  return path.resolve(process.cwd(), ".firmos-docs");
}

/**
 * §13 download security: reject any path containing a ".." segment, resolve
 * it against the docs root, and verify the result is still contained under
 * that root before any read or write touches the filesystem.
 */
export function absDocPath(relPath: string, root: string = docsRoot()): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new StorageError("traversal", "empty document path");
  }
  const segments = relPath.split(/[\\/]+/);
  if (segments.some((s) => s === "..")) {
    throw new StorageError("traversal", "document path may not contain '..'");
  }
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new StorageError("traversal", "document path escapes the docs root");
  }
  return resolved;
}

function localDriver(): StorageDriver {
  return {
    async put(relPath, bytes) {
      const abs = absDocPath(relPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    },
    async get(relPath) {
      const abs = absDocPath(relPath);
      try {
        return await readFile(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new StorageError("not_found", "document file is missing from storage");
        }
        throw new StorageError("io", "could not read the document file");
      }
    },
    async delete(relPath) {
      const abs = absDocPath(relPath);
      await unlink(abs).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw new StorageError("io", "could not delete the document file");
      });
    },
    // Local files are streamed through the API route; there is no URL.
    async signedUrl() {
      return null;
    },
  };
}

// ── Vercel Blob driver (production) ───────────────────────────────────────

function blobToken(): string | undefined {
  // Explicit token wins; on Vercel the @vercel/blob SDK falls back to the
  // runtime's VERCEL_OIDC_TOKEN for stores linked to this project.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return undefined;
  if (!token) {
    throw new StorageError(
      "config",
      "FIRMOS_STORAGE_DRIVER=vercel-blob requires BLOB_READ_WRITE_TOKEN (or the Vercel OIDC link)",
    );
  }
  return token;
}

/**
 * Private-access Vercel Blob store. Documents are never public; downloads
 * stream through the API route via get(). Untestable without a live token -
 * the local driver is the one the test suite exercises.
 */
async function blobDriver(): Promise<StorageDriver> {
  const { put, get, del, head } = await import("@vercel/blob");
  return {
    async put(relPath, bytes) {
      await put(relPath, Buffer.from(bytes), {
        access: "private",
        token: blobToken(),
        allowOverwrite: true,
        addRandomSuffix: false,
      });
    },
    async get(relPath) {
      const result = await get(relPath, { access: "private", token: blobToken() });
      if (!result || result.statusCode !== 200) {
        throw new StorageError("not_found", "document file is missing from storage");
      }
      const chunks: Uint8Array[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return bytes;
    },
    async delete(relPath) {
      await del(relPath, { token: blobToken() });
    },
    async signedUrl(relPath) {
      const meta = await head(relPath, { token: blobToken() }).catch(() => null);
      return meta ? meta.downloadUrl : null;
    },
  };
}

// ── Driver selection ──────────────────────────────────────────────────────

export type StorageDriverName = "local" | "vercel-blob";

export function storageDriverName(): StorageDriverName {
  return process.env.FIRMOS_STORAGE_DRIVER === "vercel-blob" ? "vercel-blob" : "local";
}

let cachedLocal: StorageDriver | null = null;
let cachedBlob: StorageDriver | null = null;

export async function getStorageDriver(): Promise<StorageDriver> {
  if (storageDriverName() === "vercel-blob") {
    cachedBlob ??= await blobDriver();
    return cachedBlob;
  }
  cachedLocal ??= localDriver();
  return cachedLocal;
}

/** Test hook: drop memoized drivers after changing FIRMOS_* env vars. */
export function __resetStorageForTests(): void {
  cachedLocal = null;
  cachedBlob = null;
}

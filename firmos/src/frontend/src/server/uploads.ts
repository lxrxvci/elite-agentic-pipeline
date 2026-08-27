/**
 * Layered upload validation (HANDOFF §13). The layers, in order:
 *
 *   1. 50 MB size cap
 *   2. extension allow-list
 *   3. MIME allow-list (a concrete declared type must be allowed)
 *   4. magic-byte sniffing against known signatures
 *   5. explicit deny-list of executable signatures
 *
 * §13 keeps this OUT of storage.ts - validation lives at the upload layer.
 * All failures are UploadValidationError with human-readable messages; the
 * server actions return them verbatim.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "csv",
  "xlsx",
  "xls",
  "docx",
  "doc",
  "txt",
  "zip",
]);

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

/** Browsers often cannot type csv/xls/txt files; these mean "no opinion". */
const UNDECLARED_MIME_TYPES: ReadonlySet<string> = new Set(["", "application/octet-stream"]);

export interface ValidatedUpload {
  /** Sanitized original file name (no path segments or control chars). */
  fileName: string;
  /** Lowercase extension without the dot. */
  ext: string;
  /** The declared MIME type as sent by the client. */
  mimeType: string;
  bytes: Uint8Array;
}

interface Signature {
  /** Bytes that must appear at `offset` for the signature to match. */
  bytes: readonly number[];
  offset?: number;
}

// §13 magic-byte sniffing: the common signatures for the allow-listed types.
const SIG_PDF: Signature = { bytes: [0x25, 0x50, 0x44, 0x46] }; // %PDF
const SIG_PNG: Signature = { bytes: [0x89, 0x50, 0x4e, 0x47] };
const SIG_JPEG: Signature = { bytes: [0xff, 0xd8, 0xff] };
const SIG_GIF: Signature = { bytes: [0x47, 0x49, 0x46, 0x38] }; // GIF8
const SIG_RIFF: Signature = { bytes: [0x52, 0x49, 0x46, 0x46] }; // RIFF
const SIG_WEBP_TAG: Signature = { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }; // WEBP
const SIG_PK: Signature = { bytes: [0x50, 0x4b] }; // ZIP and OOXML containers
const SIG_OLE2: Signature = { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] };

/**
 * Extensions whose content must match a known signature. xlsx/docx/zip are
 * all PK containers; xls/doc are OLE2. csv/txt are signature-less text and
 * are covered by the executable deny-list instead.
 */
const REQUIRED_SIGNATURES: Record<string, Signature[]> = {
  pdf: [SIG_PDF],
  png: [SIG_PNG],
  jpg: [SIG_JPEG],
  jpeg: [SIG_JPEG],
  gif: [SIG_GIF],
  webp: [SIG_RIFF, SIG_WEBP_TAG],
  zip: [SIG_PK],
  xlsx: [SIG_PK],
  docx: [SIG_PK],
  xls: [SIG_OLE2],
  doc: [SIG_OLE2],
};

// §13 explicit deny-list: executable signatures are refused outright.
const DENIED_SIGNATURES: { name: string; bytes: readonly number[] }[] = [
  { name: "Windows executable", bytes: [0x4d, 0x5a] }, // MZ
  { name: "ELF executable", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: "Mach-O executable", bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { name: "Mach-O executable", bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { name: "Mach-O executable", bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { name: "Mach-O executable", bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: "Mach-O universal binary", bytes: [0xca, 0xfe, 0xba, 0xbe] },
  { name: "shell script", bytes: [0x23, 0x21] }, // #!
];

function startsWith(bytes: Uint8Array, sig: Signature): boolean {
  const offset = sig.offset ?? 0;
  if (bytes.length < offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => bytes[offset + i] === b);
}

/** Original file name with path segments and control characters stripped. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // eslint-disable-next-line no-control-regex -- deliberate: strip control chars from upload names
  const cleaned = base.replace(/[\x00-\x1f]/g, "").trim();
  return cleaned === "" ? "upload" : cleaned;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Run all five §13 layers. Returns the sanitized, validated upload or throws
 * UploadValidationError with a human-readable reason.
 */
export function validateUpload(
  rawFileName: string,
  declaredMimeType: string | null | undefined,
  bytes: Uint8Array,
): ValidatedUpload {
  // Layer 1 - size cap.
  if (bytes.length === 0) {
    throw new UploadValidationError("The file is empty.");
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("The file is over the 50 MB upload limit.");
  }

  const fileName = sanitizeFileName(rawFileName);
  const ext = extensionOf(fileName);

  // Layer 2 - extension allow-list.
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new UploadValidationError(
      ext === ""
        ? "The file has no extension; allowed types are: " + [...ALLOWED_EXTENSIONS].join(", ") + "."
        : `".${ext}" files cannot be uploaded here. Allowed types are: ` +
            [...ALLOWED_EXTENSIONS].join(", ") +
            ".",
    );
  }

  // Layer 3 - MIME allow-list. A concrete declared type must be allowed;
  // "no opinion" declarations (empty / octet-stream) pass through.
  const mime = (declaredMimeType ?? "").toLowerCase();
  if (!UNDECLARED_MIME_TYPES.has(mime) && !ALLOWED_MIME_TYPES.has(mime)) {
    throw new UploadValidationError(`Files of type "${mime}" cannot be uploaded here.`);
  }

  // Layer 5 first (deny always wins) - executable signatures.
  for (const denied of DENIED_SIGNATURES) {
    if (startsWith(bytes, denied)) {
      throw new UploadValidationError(
        `This file looks like a ${denied.name}, which cannot be uploaded.`,
      );
    }
  }

  // Layer 4 - magic-byte sniffing: content must match the claimed extension.
  const required = REQUIRED_SIGNATURES[ext];
  if (required && !required.every((sig) => startsWith(bytes, sig))) {
    throw new UploadValidationError(
      `The file's contents do not match its ".${ext}" extension. It may be misnamed or corrupted.`,
    );
  }

  return { fileName, ext, mimeType: mime, bytes };
}

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { createdAt, updatedAt } from "./shared";
import { accounts } from "./accounts";
import { clients } from "./clients";
import { users } from "./users";

/**
 * Documents (HANDOFF §7 - 2 models; §13 storage).
 *
 * Files live under a deterministic, human-navigable relative layout:
 *   {client}/Documents/Statements/{account}/{year}/{MMDDYY}.ext
 *   {client}/Documents/{folder or year}/{MMDDYY}.ext
 *   TaskUploads/task-{id}/..., chat_attachments/{channel_id}/...
 * stored_path is always relative to the docs root; absolute resolution and
 * the path-traversal guard are the app layer's job (§13).
 */

/** §7 - user-created folders in the client document tree. */
export const documentFolders = pgTable(
  "document_folders",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnyPgColumn => documentFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // §13 - Statements and Reports are protected top-level folders: they
    // cannot be renamed, moved, or deleted.
    isProtected: boolean("is_protected").notNull().default(false),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("document_folders_client_idx").on(t.clientId),
    uniqueIndex("document_folders_name_unique").on(t.clientId, t.parentId, t.name),
  ],
);

/**
 * §7/§13 - file metadata. Statements (doc_type='statement') feed
 * reconciliation and the admin queue; uploaded months are derived from
 * these rows, preferring the stored attributed_year/attributed_month.
 * Statement re-uploads reuse the deterministic path and update the row in
 * place; general uploads always insert a new row (§13 versioning rule).
 */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    // Nullable: task uploads with no client live under TaskUploads/ (§13).
    clientId: integer("client_id").references(() => clients.id),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    folderId: integer("folder_id").references(() => documentFolders.id, { onDelete: "set null" }),
    uploadedById: integer("uploaded_by_id").references((): AnyPgColumn => users.id),
    fileName: text("file_name").notNull(),
    storedPath: text("stored_path").notNull(), // relative to docs root (§13)
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    // statement | report | w9 | tax | receipt | general | …(§13, §18)
    docType: text("doc_type").notNull().default("general"),
    // §5 - every statement document stores its accounting month.
    statementDate: date("statement_date", { mode: "string" }),
    attributedYear: integer("attributed_year"),
    attributedMonth: smallint("attributed_month"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Statement queue derivation (§6.7): documents per account per period.
    index("documents_account_period_idx").on(t.accountId, t.attributedYear, t.attributedMonth),
    index("documents_client_type_idx").on(t.clientId, t.docType),
    // Statement re-uploads reuse the deterministic path and update in place.
    uniqueIndex("documents_stored_path_unique").on(t.storedPath),
  ],
);

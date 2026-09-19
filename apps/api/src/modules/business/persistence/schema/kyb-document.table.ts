import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { KybDocumentStatus, KybDocumentType } from "@yourtal/contracts/business/kyb-document";
import { businessAccounts } from "./business-account.table";
import { businessPgSchema } from "./business-schema";

/**
 * `storageRef` points at an encrypted object elsewhere (docs/15 — R2 + Cloud
 * KMS); this table never holds document bytes, only the reference and the
 * expiry/status tracked against it.
 */
export const kybDocuments = businessPgSchema.table("kyb_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessAccounts.id),
  documentType: text("document_type").notNull().$type<KybDocumentType>(),
  storageRef: text("storage_ref").notNull(),
  status: text("status").notNull().$type<KybDocumentStatus>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: text("verified_by_user_id"),
});

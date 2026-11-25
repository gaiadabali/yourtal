import { kybDocumentTypeSchema } from "@yourtal/contracts/business/kyb-document";
import type { KybDocument, KybDocumentType } from "@yourtal/contracts/business/kyb-document";

export const KYB_DOCUMENT_TYPES = kybDocumentTypeSchema.options;

export type KybRowStatus = "missing" | KybDocument["status"];

export interface KybRow {
  type: KybDocumentType;
  status: KybRowStatus;
}

/** One row per required document type, from the newest document of each type; a type never uploaded is `missing`. */
export function kybRows(documents: readonly KybDocument[]): KybRow[] {
  return KYB_DOCUMENT_TYPES.map((type) => {
    const newest = documents
      .filter((doc) => doc.documentType === type)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return { type, status: newest?.status ?? "missing" };
  });
}

/** A document can be (re)uploaded while it is missing, waiting for review, or was refused or expired; never once approved. */
export function canUploadKyb(status: KybRowStatus): boolean {
  return status !== "verified";
}

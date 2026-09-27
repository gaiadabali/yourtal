/**
 * TASKS.md 7.1.b: "KYB documents upload through a presigned MinIO URL, so
 * `storageRef` points to a real upload" — before this, `storageRef` was a
 * free string the client typed in, never checked against anything
 * (docs/audit/2026-09-25/business-merchant.md). This port is the business
 * module's own object-storage seam: a presigned PUT to mint, and an
 * existence check so `submit-kyb-document.use-case.ts` can refuse a
 * `storageRef` nothing was ever uploaded to.
 */
export interface CreateKybUploadUrlInput {
  readonly businessId: string;
  readonly contentType: string;
}

export interface KybUploadUrl {
  /** The opaque object key `submitKybDocument`'s `storageRef` must equal — never a full URL (docs/15: no bucket layout leaks past this module). */
  readonly storageRef: string;
  /** A presigned PUT, valid for `expiresAt` only. */
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

export interface KybObjectStorage {
  createUploadUrl(input: CreateKybUploadUrlInput): Promise<KybUploadUrl>;
  /** Does an object exist at this key? Used to refuse a `storageRef` nobody actually uploaded to. */
  exists(storageRef: string): Promise<boolean>;
}

export const KYB_OBJECT_STORAGE = Symbol("KYB_OBJECT_STORAGE");

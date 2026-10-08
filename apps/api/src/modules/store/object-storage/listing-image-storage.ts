/**
 * The store module's seam to object storage for listing pictures: one presigned PUT that
 * lands under a public-read prefix, so the merchant's browser uploads the file directly and
 * the platform only ever sees the URL (the same direct-upload shape as the KYB documents).
 */
export interface ListingImageUploadUrl {
  readonly uploadUrl: string;
  /** Where the picture is served once uploaded. */
  readonly imageUrl: string;
  readonly expiresAt: string;
}

export interface ListingImageStorage {
  createUploadUrl(input: {
    readonly businessId: string;
    readonly contentType: string;
  }): Promise<ListingImageUploadUrl>;
}

export const LISTING_IMAGE_STORAGE = Symbol("LISTING_IMAGE_STORAGE");

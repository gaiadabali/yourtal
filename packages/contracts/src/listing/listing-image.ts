import * as z from "zod";
import { LISTING_IMAGE_CONTENT_TYPES } from "./listing-image-values";

/** `POST /api/{tenantId}/store/listing-images/upload-url`: the type of the picture about to be uploaded. */
export const createListingImageUploadUrlRequestSchema = z.object({
  contentType: z.enum(LISTING_IMAGE_CONTENT_TYPES),
});
export type CreateListingImageUploadUrlRequest = z.infer<
  typeof createListingImageUploadUrlRequestSchema
>;

/**
 * A presigned PUT for the browser and the public URL the picture will have once it lands. Pass
 * `imageUrl` to `POST .../store/listings`; the PUT itself must send the same `content-type`.
 */
export const listingImageUploadSchema = z.object({
  uploadUrl: z.url(),
  imageUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ListingImageUpload = z.infer<typeof listingImageUploadSchema>;

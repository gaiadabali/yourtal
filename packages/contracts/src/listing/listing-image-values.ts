// Zod-free, so the Studio listing form can import these without pulling zod.

/** The picture on a reward card: web formats only, never a script-capable type such as SVG. */
export const LISTING_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ListingImageContentType = (typeof LISTING_IMAGE_CONTENT_TYPES)[number];

/** The most a listing picture may weigh; the form refuses anything larger before it uploads. */
export const LISTING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

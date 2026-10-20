import * as z from "zod";

/**
 * 14.6.b: one size of a poster, for `srcset`. `posterUrl` stays on the contract as
 * the fallback (it is the 640 px size); a list may be empty for a poster the media
 * pipeline did not make, and an older server sends none.
 */
export const posterVariantSchema = z.object({
  url: z.url(),
  /** Pixel width of the image: `srcset`'s `w` descriptor. */
  width: z.number().int().positive(),
});
export type PosterVariant = z.infer<typeof posterVariantSchema>;

export const posterVariantsSchema = z.array(posterVariantSchema).max(8).default([]);

/**
 * 14.6.b: responsive posters. Every poster is stored at three sizes, named by
 * the long side of the image, so the pipeline, the staging backfill and the API
 * all agree on the keys without a lookup. Pure (no node or S3 imports), so any
 * package may use it.
 *
 * - 640 is the card-size poster and keeps its original key: it IS `posterUrl`.
 * - 320 and 960 sit beside it as `posters/<id>-320.jpg` and `posters/<id>-960.jpg`.
 *
 * Only posters under the public `posters/<uuid>.jpg` shape have variants.
 * Anything else (the Snap App poster, listing pictures, external URLs) gets none
 * and callers fall back to the single `posterUrl`.
 */

export const POSTER_LONG_SIDES = [320, 640, 960] as const;
export type PosterLongSide = (typeof POSTER_LONG_SIDES)[number];

/** The card-size poster: the one `posterUrl` points at. */
export const POSTER_LONG_SIDE: PosterLongSide = 640;

/**
 * `ffmpeg -q:v` per size. The 960 is made from the source frame when the source
 * is HD, and by enlarging the stored 640 when backfilling; a higher quality
 * number keeps both near 45 KB so the biggest candidate costs the first frame
 * little.
 */
export const POSTER_JPEG_QUALITY: Readonly<Record<PosterLongSide, number>> = {
  320: 5,
  640: 5,
  960: 7,
};

export type PosterAspect = "16:9" | "9:16";

export interface PosterVariant {
  readonly url: string;
  /** Pixel width of the image, for `srcset`'s `w` descriptor. */
  readonly width: number;
}

/** `posters/<uuid>.jpg`, the only shape that has variants. */
const BASE_KEY = /(posters\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/i;

/** The object key a public poster URL points at, if it is one of ours. */
export function posterKeyOf(url: string): string | null {
  const match = /\/(posters\/[0-9a-f-]+\.jpg)$/i.exec(url);
  return match?.[1] ?? null;
}

/** The key of one size of the poster stored at `baseKey` (the 640). */
export function posterVariantKey(baseKey: string, longSide: PosterLongSide): string | null {
  const match = BASE_KEY.exec(baseKey);
  if (match === null) return null;
  return longSide === POSTER_LONG_SIDE ? baseKey : `${match[1]}-${String(longSide)}.jpg`;
}

/** Width in pixels of a poster whose long side is `longSide`. */
export function posterWidth(longSide: PosterLongSide, aspect: PosterAspect): number {
  return aspect === "16:9" ? longSide : Math.round((longSide * 9) / 16);
}

/**
 * Every size of the poster at `posterUrl`, smallest first, or an empty list when
 * the URL is not one of the pipeline's own.
 */
export function posterVariantsFor(posterUrl: string, aspect: PosterAspect): PosterVariant[] {
  const match = BASE_KEY.exec(posterUrl);
  if (match === null) return [];
  const origin = posterUrl.slice(0, match.index);
  return POSTER_LONG_SIDES.map((longSide) => ({
    url:
      longSide === POSTER_LONG_SIDE
        ? posterUrl
        : `${origin}${match[1] ?? ""}-${String(longSide)}.jpg`,
    width: posterWidth(longSide, aspect),
  }));
}

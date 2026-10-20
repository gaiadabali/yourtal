import type { PosterVariant } from "@yourtal/contracts/campaign/poster-variant";

/**
 * 14.6.b: a poster's sizes as `srcset`'s value, or `undefined` when there is only the
 * fallback `posterUrl` (a poster the media pipeline did not make, or an older server).
 */
export function posterSrcSet(variants: readonly PosterVariant[]): string | undefined {
  if (variants.length < 2) return undefined;
  return variants.map((variant) => `${variant.url} ${String(variant.width)}w`).join(", ");
}

/** Attributes for a plain `<img>`; nothing at all when there is no `srcset` to give. */
export function posterImgProps(
  variants: readonly PosterVariant[],
  sizes: string,
): { srcSet: string; sizes: string } | Record<string, never> {
  const srcSet = posterSrcSet(variants);
  return srcSet === undefined ? {} : { srcSet, sizes };
}

/** The same, under the names `MediaCard` and `VerticalFeedVideo` take. */
export function posterCardProps(
  variants: readonly PosterVariant[],
  sizes: string,
): { posterSrcSet: string; posterSizes: string } | Record<string, never> {
  const srcSet = posterSrcSet(variants);
  return srcSet === undefined ? {} : { posterSrcSet: srcSet, posterSizes: sizes };
}

/**
 * What `sizes` says about each place a poster renders: the CSS width of the image, so the
 * browser can pick a size once it knows the screen's density. Side nav is 14rem from lg up.
 */
export const POSTER_SIZES = {
  /** Shorts: one centred card, at most 440px, with a 1rem gutter each side. */
  shorts: "min(440px, calc(100vw - 2rem))",
  /** Home and search grids (1, 2, 3, 4, 5 columns by breakpoint). */
  grid: "(min-width: 1536px) calc((100vw - 16rem) / 5), (min-width: 1280px) calc((100vw - 16rem) / 4), (min-width: 1024px) calc((100vw - 16rem) / 3), (min-width: 640px) 50vw, 100vw",
  /** The featured card on Home spans two of three columns from lg up. */
  feature: "(min-width: 1024px) calc((100vw - 16rem) * 2 / 3), 100vw",
  /** Continue-watching cards are a fixed 16rem. */
  shelf: "256px",
  /** Search's campaign results: 2, 3 and 4 columns. */
  results: "(min-width: 1280px) calc((100vw - 16rem) / 4), (min-width: 768px) 33vw, 50vw",
  /** The small thumbnails beside a title (w-24 and w-28). */
  thumbSmall: "96px",
  thumbMedium: "112px",
} as const;

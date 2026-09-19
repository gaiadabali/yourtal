import type { Metadata } from "next";

/**
 * Builds `metadata.twitter` for a public entity page that already has an
 * Open Graph card image (YT-0212). Every campaign/offer/merchant/catalogue
 * page already ships a real `opengraph-image.tsx` (Phase U), but that file
 * convention only emits `og:image` — it does **not** emit `twitter:card` or
 * `twitter:image`
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`:
 * `opengraph-image`/`twitter-image` are separate conventions). Without an
 * explicit `twitter` metadata block, X/Twitter has nothing telling it to
 * render a large-image card at all, even though the same honest reward
 * card WhatsApp/Instagram/Facebook show already exists at a real URL.
 *
 * Deliberately reuses the exact `title`/`description`/`imageUrl` the
 * caller's own `openGraph` metadata (or page body) already computed,
 * rather than writing a second copy — the two surfaces must never show
 * different copy for the same link, the same reasoning
 * `public-og-card.tsx`'s `rewardLine` prop documents for its own honesty
 * requirement.
 */
export function publicTwitterCard(params: {
  title: string;
  description: string;
  imageUrl: string;
}): Metadata["twitter"] {
  return {
    card: "summary_large_image",
    title: params.title,
    description: params.description,
    images: [params.imageUrl],
  };
}

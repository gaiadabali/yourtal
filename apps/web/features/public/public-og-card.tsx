/**
 * Shared OG/share-card markup for every public entity page (YT-0431).
 * Rendered through Next's built-in `ImageResponse` (`next/og`) inside each
 * route's `opengraph-image.tsx` — no remote asset fetch, no custom font
 * load, so there is nothing here that can fail a build or a crawl.
 *
 * `ImageResponse` renders through Satori, which only understands inline
 * `style` objects (flexbox subset), not Tailwind classes or a stylesheet —
 * this file intentionally does not use `className` anywhere.
 *
 * `rewardLine` is the one non-negotiable prop: docs/11-seo-aeo-geo.md's
 * Open Graph requirement is "Include the reward and duration in the card,
 * for the same honesty reason [as the page copy]" — a share card that shows
 * a merchant's logo and a headline but drops the actual number is the
 * dishonest split this ticket exists to prevent, so every caller builds
 * this string from the same `public-reward-facts.ts` values the page body
 * renders.
 */
export interface PublicOgCardProps {
  eyebrow: string;
  title: string;
  merchantName: string;
  rewardLine: string;
}

const PAGE_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: "64px",
  backgroundColor: "#0f172a",
  color: "#f8fafc",
  fontFamily: "sans-serif",
};

export function PublicOgCard({ eyebrow, title, merchantName, rewardLine }: PublicOgCardProps) {
  return (
    <div style={PAGE_STYLE}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <span
          style={{ fontSize: 28, letterSpacing: 2, textTransform: "uppercase", color: "#94a3b8" }}
        >
          {eyebrow}
        </span>
        <span style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>{title}</span>
        <span style={{ fontSize: 32, color: "#cbd5e1" }}>{merchantName}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: "#fbbf24" }}>{rewardLine}</span>
        <span style={{ fontSize: 28, color: "#94a3b8" }}>YourTal</span>
      </div>
    </div>
  );
}

export const PUBLIC_OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const PUBLIC_OG_IMAGE_CONTENT_TYPE = "image/png";

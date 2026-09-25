import type { ReactNode } from "react";

/**
 * Shared OG/share-card markup for every public page, rendered through
 * `ImageResponse` (`next/og`) in each route's `opengraph-image.tsx`. Satori
 * only understands inline `style` objects, so there is no `className` here,
 * and no remote asset or font fetch that could fail a build.
 *
 * `rewardLine` is required on entity cards: a share card must state the
 * same reward and duration the page does, built from `public-reward-facts.ts`.
 */
export interface PublicOgCardProps {
  eyebrow: string;
  title: string;
  merchantName: string;
  rewardLine: string;
}

// After Dark tokens (packages/ui/src/styles/tokens.css), inlined for Satori.
const INK_950 = "#0b0b0f";
const INK_25 = "#f5f5f7";
const INK_300 = "#b0b0bf";
const ROSE_500 = "#ff3d6e";
const GOLD_400 = "#ffc53d";
const GOLD_950 = "#1a1300";

const PAGE_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: "64px",
  backgroundColor: INK_950,
  backgroundImage: `radial-gradient(circle at 100% 0%, ${ROSE_500}55 0%, ${INK_950} 55%)`,
  color: INK_25,
  fontFamily: "sans-serif",
};

// The coin glyph from packages/ui/src/brand/coin-mark.tsx on the gold badge.
function OgBrand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: GOLD_400,
        }}
      >
        <svg width="34" height="34" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke={GOLD_950} strokeWidth="1.4" />
          <path
            d="M5.8 6c0-.9.9-1.6 2.2-1.6s2.2.6 2.2 1.4c0 1.7-4.4.9-4.4 2.7 0 .8 1 1.5 2.2 1.5s2.2-.7 2.2-1.6M8 3.6v8.8"
            stroke={GOLD_950}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span style={{ fontSize: 40, fontWeight: 800 }}>YourTal</span>
    </div>
  );
}

function OgFrame({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div style={PAGE_STYLE}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <span
          style={{ fontSize: 28, letterSpacing: 2, textTransform: "uppercase", color: ROSE_500 }}
        >
          {eyebrow}
        </span>
        {children}
      </div>
      <OgBrand />
    </div>
  );
}

export function PublicOgCard({ eyebrow, title, merchantName, rewardLine }: PublicOgCardProps) {
  return (
    <OgFrame eyebrow={eyebrow}>
      <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>{title}</span>
      <span style={{ fontSize: 32, color: INK_300 }}>{merchantName}</span>
      <span style={{ fontSize: 44, fontWeight: 700, color: GOLD_400 }}>{rewardLine}</span>
    </OgFrame>
  );
}

export interface PublicPageOgCardProps {
  eyebrow: string;
  title: string;
  description: string;
}

/** For pages with no reward of their own: help, terms, the locale root. */
export function PublicPageOgCard({ eyebrow, title, description }: PublicPageOgCardProps) {
  return (
    <OgFrame eyebrow={eyebrow}>
      <span style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{title}</span>
      <span style={{ fontSize: 34, color: INK_300, lineHeight: 1.3 }}>{description}</span>
    </OgFrame>
  );
}

export const PUBLIC_OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const PUBLIC_OG_IMAGE_CONTENT_TYPE = "image/png";

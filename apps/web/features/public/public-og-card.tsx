import type { ReactNode } from "react";
import { LOCKUP_HEIGHT, LOCKUP_PATH, LOCKUP_WIDTH } from "@yourtal/ui/brand/brand-paths";

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

// Brand tokens (packages/ui/src/styles/tokens.css), inlined for Satori.
const CHARCOAL = "#363636";
const INK_25 = "#f5f5f5";
const INK_300 = "#d0d0d0";
const YELLOW = "#ffda00";
const GOLD_400 = "#ffc53d";

const PAGE_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: "64px",
  backgroundColor: CHARCOAL,
  color: INK_25,
  fontFamily: "sans-serif",
};

// The official lockup (brand-paths.ts) in Play Yellow on the Charcoal page, the guide's pairing.
function OgBrand() {
  const height = 64;
  return (
    <svg
      width={Math.round((height * LOCKUP_WIDTH) / LOCKUP_HEIGHT)}
      height={height}
      viewBox={`0 0 ${LOCKUP_WIDTH} ${LOCKUP_HEIGHT}`}
    >
      <path fill={YELLOW} fillRule="evenodd" d={LOCKUP_PATH} />
    </svg>
  );
}

function OgFrame({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div style={PAGE_STYLE}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <span style={{ fontSize: 28, letterSpacing: 2, textTransform: "uppercase", color: YELLOW }}>
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

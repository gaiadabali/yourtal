import * as React from "react";
import { cn } from "../cn";
import { CoinMark } from "./coin-mark";

const SIZES = {
  sm: { text: "text-title", badge: "h-6 w-6", coin: 14, gap: "gap-1.5" },
  md: { text: "text-headline", badge: "h-8 w-8", coin: 18, gap: "gap-2" },
  lg: { text: "text-display", badge: "h-11 w-11", coin: 26, gap: "gap-2" },
  xl: { text: "text-display-lg", badge: "h-14 w-14", coin: 34, gap: "gap-3" },
} as const;

export type BrandMarkSize = keyof typeof SIZES;

export interface BrandMarkProps {
  size?: BrandMarkSize;
  // `| undefined` so a wrapper that forwards its own optional className
  // (e.g. `apps/web/features/shell/wordmark.tsx`) type-checks under
  // `exactOptionalPropertyTypes` without needing a fallback default.
  className?: string | undefined;
}

/**
 * The YourTal mark alone: the points coin glyph (`CoinMark`) on a filled
 * gold badge — the same gold-fill-plus-`text-fg-on-points` pairing every
 * `PointsChip` uses, so a coin means the same thing wherever it appears.
 * Purely decorative (`aria-hidden`); pair it with a real accessible name
 * from the surrounding link/button, or with `BrandWordmark` for the name
 * spelled out.
 */
export const BrandMark = React.forwardRef<HTMLSpanElement, BrandMarkProps>(function BrandMark(
  { size = "md", className },
  ref,
) {
  const { badge, coin } = SIZES[size];
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-points text-fg-on-points",
        badge,
        className,
      )}
    >
      <CoinMark size={coin} />
    </span>
  );
});
BrandMark.displayName = "BrandMark";

export interface WordmarkProps {
  size?: BrandMarkSize;
  className?: string | undefined;
  /**
   * Overrides the accessible name of the whole mark+text group (only
   * needed when something other than the visible text should be read out,
   * e.g. hiding the group and giving the name to a wrapping link instead).
   * Nothing is baked in by default: "YourTal" is the brand's own name, not
   * user-facing copy the bilingual catalogues translate, so the visible
   * text already is the accessible name.
   */
  "aria-label"?: string;
}

/** The YourTal wordmark: the coin mark plus "YourTal" in the display face. */
export const BrandWordmark = React.forwardRef<HTMLSpanElement, WordmarkProps>(
  function BrandWordmark({ size = "md", className, "aria-label": ariaLabel }, ref) {
    const { text, gap } = SIZES[size];
    return (
      <span
        ref={ref}
        aria-label={ariaLabel}
        className={cn("inline-flex items-center", gap, className)}
      >
        <BrandMark size={size} />
        <span className={cn(text, "font-display font-extrabold text-fg")}>YourTal</span>
      </span>
    );
  },
);
BrandWordmark.displayName = "BrandWordmark";

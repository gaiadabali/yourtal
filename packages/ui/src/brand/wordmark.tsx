import * as React from "react";
import { cn } from "../cn";
import {
  LOCKUP_HEIGHT,
  LOCKUP_PATH,
  LOCKUP_WIDTH,
  MARK_HEIGHT,
  MARK_PATH,
  MARK_WIDTH,
} from "./brand-paths";

/**
 * Rendered heights in px. The artwork keeps its own proportions at every size. The
 * smallest full lockup is 22 px high, 138 px wide: the guide's 120 px floor (p9) holds.
 */
const HEIGHTS = { sm: 22, md: 30, lg: 42, xl: 60 } as const;

/**
 * The logo is yellow line art made for the Charcoal ground (brand guide, pp10-11: never
 * swap in other colours), so it is drawn on a Charcoal plate on every surface, light or
 * dark. The plate's padding is the clear space around the artwork.
 */
const PLATE = "inline-flex max-w-full shrink-0 items-center rounded-card bg-brand-ground";
const PLATE_PAD = { sm: "px-3 py-2", md: "px-4 py-2.5", lg: "px-5 py-3", xl: "px-6 py-4" } as const;

export type BrandMarkSize = keyof typeof HEIGHTS;

export interface BrandMarkProps {
  size?: BrandMarkSize;
  /** Draw the Charcoal plate. Pass `false` only on a surface that is already Charcoal. */
  ground?: boolean;
  // `| undefined` so a wrapper that forwards its own optional className
  // type-checks under `exactOptionalPropertyTypes` without a fallback default.
  className?: string | undefined;
}

/**
 * The YourTal submark alone: the official ribbon-and-dot symbol in Play Yellow, on the
 * Charcoal plate. Purely decorative (`aria-hidden`): pair it with a real accessible
 * name from the surrounding link or button.
 */
export const BrandMark = React.forwardRef<HTMLSpanElement, BrandMarkProps>(function BrandMark(
  { size = "md", ground = true, className },
  ref,
) {
  const height = HEIGHTS[size];
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(ground ? [PLATE, PLATE_PAD[size]] : "inline-flex shrink-0", className)}
    >
      <svg
        focusable="false"
        viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
        width={Math.round((height * MARK_WIDTH) / MARK_HEIGHT)}
        height={height}
        className="text-brand-logo"
      >
        <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
      </svg>
    </span>
  );
});
BrandMark.displayName = "BrandMark";

export interface WordmarkProps {
  size?: BrandMarkSize;
  /** Draw the Charcoal plate. Pass `false` only on a surface that is already Charcoal. */
  ground?: boolean;
  className?: string | undefined;
  /**
   * Overrides the accessible name of the logo (only needed when something
   * other than the brand name should be read out). "YourTal" is the brand's
   * own name, not copy the bilingual catalogues translate, so it is the default.
   */
  "aria-label"?: string;
}

/**
 * The official YourTal logo: ribbon mark and "YourTal" lettering as one drawing in Play
 * Yellow on the Charcoal plate. The lettering is custom artwork, not a font, so the whole
 * lockup is one image with an accessible name.
 */
export const BrandWordmark = React.forwardRef<HTMLSpanElement, WordmarkProps>(
  function BrandWordmark(
    { size = "md", ground = true, className, "aria-label": ariaLabel = "YourTal" },
    ref,
  ) {
    const height = HEIGHTS[size];
    return (
      <span
        ref={ref}
        className={cn(ground ? [PLATE, PLATE_PAD[size]] : "inline-flex shrink-0", className)}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${LOCKUP_WIDTH} ${LOCKUP_HEIGHT}`}
          width={Math.round((height * LOCKUP_WIDTH) / LOCKUP_HEIGHT)}
          height={height}
          className="h-auto max-w-full text-brand-logo"
        >
          <path fill="currentColor" fillRule="evenodd" d={LOCKUP_PATH} />
        </svg>
      </span>
    );
  },
);
BrandWordmark.displayName = "BrandWordmark";

export interface BrandLogoProps {
  className?: string | undefined;
}

/**
 * The logo for a tight header: the full lockup from 420 px wide, the submark below it.
 * The brand guide (p9) sets a 120 px floor for the lockup and says to use the icon under
 * it. One image with one name, whichever of the two drawings the width shows.
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span role="img" aria-label="YourTal" className={className}>
      <BrandMark size="sm" className="min-[420px]:hidden" />
      <BrandWordmark size="sm" className="hidden min-[420px]:inline-flex" />
    </span>
  );
}

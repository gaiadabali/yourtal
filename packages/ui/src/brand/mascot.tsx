import * as React from "react";
import { cn } from "../cn";
import { MASCOT_HEIGHT, MASCOT_PATH, MASCOT_WIDTH } from "./brand-paths";

/** Artwork widths in px, before the plate's padding. */
const WIDTHS = { sm: 40, md: 64, lg: 96, xl: 140 } as const;
const PLATE_PAD = { sm: "p-2", md: "p-3", lg: "p-4", xl: "p-5" } as const;

export type MascotSize = keyof typeof WIDTHS;

export interface MascotProps {
  size?: MascotSize;
  className?: string | undefined;
  /**
   * The accessible name, from the caller's catalogue (en-AU and id-ID): this
   * package has no i18n of its own. Leave it out when the mascot sits next to
   * text that already says what the screen means: it is then hidden from
   * assistive technology.
   */
  label?: string | undefined;
  /**
   * Draw the Charcoal plate. The mascot is Play Yellow line art made for dark, calm
   * grounds (brand guide, p22), so it always sits on one; pass `false` only where the
   * surface behind it already is Charcoal.
   */
  ground?: boolean;
  /** A slow bob for a moment of delight. Respects `prefers-reduced-motion`. */
  bob?: boolean;
}

/**
 * The YourTal mascot in its Friendly default: a screen-bodied character wearing the
 * ribbon mark as its face. The artwork is the official line art, traced as-is: no
 * redrawn features, no extra colours, no fill, never stretched, rotated or cropped.
 */
export const Mascot = React.forwardRef<HTMLSpanElement, MascotProps>(function Mascot(
  { size = "md", className, label, ground = true, bob = false },
  ref,
) {
  const width = WIDTHS[size];
  const named = label !== undefined && label !== "";
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        ground && ["rounded-sheet bg-brand-ground", PLATE_PAD[size]],
        bob && "motion-safe:animate-[mascot-bob_3.2s_ease-in-out_infinite]",
        className,
      )}
    >
      <svg
        role={named ? "img" : undefined}
        aria-label={named ? label : undefined}
        aria-hidden={named ? undefined : true}
        focusable="false"
        viewBox={`0 0 ${MASCOT_WIDTH} ${MASCOT_HEIGHT}`}
        width={width}
        height={Math.round((width * MASCOT_HEIGHT) / MASCOT_WIDTH)}
        className="text-brand-logo"
      >
        <path fill="currentColor" fillRule="evenodd" d={MASCOT_PATH} />
      </svg>
    </span>
  );
});
Mascot.displayName = "Mascot";

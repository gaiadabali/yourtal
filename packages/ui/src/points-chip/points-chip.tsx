import * as React from "react";
import { cn } from "../cn";
import { CoinMark } from "../brand/coin-mark";

const SIZES = {
  sm: { chip: "h-6 gap-1 px-2 text-caption", coin: 12 },
  md: { chip: "h-8 gap-1.5 px-3 text-label", coin: 16 },
  lg: { chip: "h-10 gap-2 px-4 text-body", coin: 20 },
} as const;

export interface PointsChipBaseProps {
  /** The points amount. Never a float — points are always whole. */
  value: number;
  /** Rendered before the number, e.g. "+" or "up to ". */
  prefix?: string;
  size?: "sm" | "md" | "lg";
  /** Number formatting locale. Defaults to en-AU; pass the viewer's region locale. */
  locale?: string;
  className?: string;
}

/**
 * The ONE way to show a points amount: gold fill, coin glyph, tabular numerals.
 * Every caller must supply the accessible name in real, translated words —
 * either directly (`aria-label`) or computed from the formatted number
 * (`formatLabel`), since "points" is never hard-coded here.
 */
export type PointsChipProps =
  | (PointsChipBaseProps & { "aria-label": string; formatLabel?: never })
  | (PointsChipBaseProps & {
      formatLabel: (formatted: string, value: number) => string;
      "aria-label"?: never;
    });

export const PointsChip = React.forwardRef<HTMLSpanElement, PointsChipProps>((props, ref) => {
  const { value, prefix = "", size = "md", locale = "en-AU", className } = props;
  const formatted = React.useMemo(
    () => new Intl.NumberFormat(locale).format(value),
    [locale, value],
  );
  const label = "formatLabel" in props ? props.formatLabel(formatted, value) : props["aria-label"];
  const { chip, coin } = SIZES[size];

  return (
    <span
      ref={ref}
      aria-label={label}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-pill bg-points font-sans font-bold text-fg-on-points",
        chip,
        className,
      )}
    >
      <CoinMark size={coin} />
      <span className="text-numeric">
        {prefix}
        {formatted}
      </span>
    </span>
  );
});
PointsChip.displayName = "PointsChip";

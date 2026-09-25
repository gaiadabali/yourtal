export interface CoinMarkProps {
  /** Pixel size of the (square) glyph. */
  size?: number;
  className?: string;
}

/**
 * The points coin glyph — the one shape that means "points" anywhere it
 * appears: `PointsChip`'s icon and the YourTal brand mark share this single
 * source (task 3.6.a), so a coin never quietly drifts into two drawings.
 * Monochrome (`currentColor`): callers set the colour with `text-*`, never
 * a colour prop, so it reads correctly on any fill it sits on top of.
 * Always decorative — the caller's own accessible name covers what it's next to.
 */
export function CoinMark({ size = 16, className }: CoinMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      className={className}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.8 6c0-.9.9-1.6 2.2-1.6s2.2.6 2.2 1.4c0 1.7-4.4.9-4.4 2.7 0 .8 1 1.5 2.2 1.5s2.2-.7 2.2-1.6M8 3.6v8.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

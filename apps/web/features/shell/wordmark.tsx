import { cn } from "@yourtal/ui/cn";

export interface WordmarkProps {
  className?: string;
}

/**
 * The provisional brand mark (task 3.5.c; 3.6 replaces this with the real
 * logo, favicon and maskable icons). The coin badge mirrors
 * `@yourtal/ui/points-chip`'s own glyph and colour rule — gold is a FILL
 * only, always paired with `text-fg-on-points`, never used as a text/stroke
 * colour on its own (that pairing fails contrast on a light canvas; see
 * `packages/ui/src/styles/contrast.test.ts`) — so the mark and every points
 * amount on screen read as the same shape.
 */
export function Wordmark({ className }: WordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-points text-fg-on-points"
      >
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
          <path
            d="M5.8 6c0-.9.9-1.6 2.2-1.6s2.2.6 2.2 1.4c0 1.7-4.4.9-4.4 2.7 0 .8 1 1.5 2.2 1.5s2.2-.7 2.2-1.6M8 3.6v8.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>
      <span className="text-title font-display font-extrabold text-fg">YourTal</span>
    </span>
  );
}

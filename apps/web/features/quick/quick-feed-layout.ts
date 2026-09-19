/**
 * Shared sizing between the real feed (`quick-feed-viewport.tsx`,
 * `quick-feed-card.tsx`) and its loading placeholder
 * (`quick-feed-skeleton.tsx`) — the same "one shared shape" pattern
 * `campaign-card-layout.tsx` uses for the earn board, so the skeleton can
 * never reserve a different height than the real content resolves into
 * (CLS <= 0.1 gate, docs/13b-typescript-standards.md §8).
 *
 * The `4rem` and the safe-area term below intentionally duplicate
 * `apps/web/features/shell/bottom-nav.tsx`'s own `h-16` height plus its
 * `env(safe-area-inset-bottom)` pad: on mobile this feed's scroll container
 * must fill exactly the viewport area `<main>` (`app-shell.tsx`) leaves
 * visible above the fixed bottom tab bar — no more (or a snapped item's
 * bottom edge would render behind the nav, which the acceptance criteria
 * forbid) and no less (or the feed would show a dead strip of page below
 * the last visible item). `apps/web/features/shell/**` belongs to a
 * different ticket and is out of scope to change here; if that shell's
 * bottom-bar height ever changes, this constant needs updating alongside
 * it.
 */
export const QUICK_FEED_VIEWPORT_HEIGHT_CLASS =
  "h-[calc(100dvh-4rem-max(0px,env(safe-area-inset-bottom)))] md:h-auto";

/** One feed item's shape: full-bleed on mobile, an honest poster-ratio grid tile from `md`. */
export const QUICK_FEED_ITEM_SHAPE_CLASS = "h-full w-full md:h-auto md:aspect-[3/4]";

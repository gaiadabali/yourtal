import { Skeleton } from "@yourtal/ui/skeleton";
import { cn } from "@yourtal/ui/cn";
import { QUICK_FEED_ITEM_SHAPE_CLASS, QUICK_FEED_VIEWPORT_HEIGHT_CLASS } from "./quick-feed-layout";

const SKELETON_ITEM_COUNT = 4;

/**
 * Suspense fallback for the Quick feed (YT-0414, docs/13b-typescript-standards.md
 * §8: "every async subtree gets an explicit `loading.tsx` or `<Suspense
 * fallback>`, and fallbacks are layout-stable"). Reuses the exact same
 * height/shape constants the real feed and its cards resolve into
 * (`quick-feed-layout.ts`), so swapping in real content never shifts the
 * page (CLS <= 0.1 gate). Purely decorative — `aria-hidden` — the loading
 * state itself is not something a screen-reader user needs narrated item
 * by item.
 */
export function QuickFeedSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col overflow-hidden",
        QUICK_FEED_VIEWPORT_HEIGHT_CLASS,
        "md:grid md:grid-cols-2 md:gap-4 md:overflow-visible lg:grid-cols-3 xl:grid-cols-4",
      )}
    >
      {Array.from({ length: SKELETON_ITEM_COUNT }, (_unused, index) => (
        <div
          key={index}
          className={cn(
            "flex shrink-0 flex-col justify-between gap-4 border-b border-border p-6 md:shrink md:rounded-xl md:border md:p-5",
            QUICK_FEED_ITEM_SHAPE_CLASS,
          )}
        >
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
}

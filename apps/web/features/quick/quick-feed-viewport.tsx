"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@yourtal/ui/cn";
import { QUICK_FEED_VIEWPORT_HEIGHT_CLASS } from "./quick-feed-layout";

export interface QuickFeedViewportProps {
  children: ReactNode;
}

const IN_VIEW_THRESHOLD = 0.6;

/**
 * The Quick feed's only client leaf (YT-0414, docs/13b-typescript-standards.md
 * §8: "push `use client` down to the smallest interactive unit"). Every
 * card it wraps (`quick-feed-card.tsx`) is a plain Server Component, passed
 * in as `children` — the composition pattern §8 asks for instead of
 * prop-drilling data across the boundary.
 *
 * Two jobs, both intentionally small:
 *
 * 1. THE SCROLL/SNAP CONTAINER ITSELF. Snapping is CSS only
 *    (`snap-y snap-mandatory` here, each item's own `snap-start
 *    snap-always` in `quick-feed-card.tsx`) — this component adds no
 *    scroll-hijacking JS. Native momentum scrolling, native keyboard
 *    scrolling (arrow keys / Page Up-Down / Home-End once the container or
 *    one of its links has focus) and native `scrollIntoView`-on-focus all
 *    keep working exactly as the browser already implements them; nothing
 *    here intercepts a scroll or wheel event.
 * 2. A screen-reader-only "Video N dari M: …" status
 *    (docs/tasks/phase-u-ui.md YT-0414: "Screen-reader users need to know
 *    where they are in the feed"), driven by an `IntersectionObserver`
 *    over each `[data-quick-feed-item]` child. `IntersectionObserver` is a
 *    read-only observation API — it cannot move, snap or otherwise affect
 *    scroll position, so using it here does not reintroduce the
 *    "JavaScript scroll hijack" the ticket warns against. If
 *    `IntersectionObserver` is unavailable, the effect simply does
 *    nothing further — the feed still renders and scrolls, only the
 *    status text never updates.
 *
 * NEVER AUTOPLAYS ANYTHING: there is no video element anywhere in this
 * feed (see `quick-feed-card.tsx`), so this observer only ever writes to a
 * text node. Scrolling an item into view — even to the point the browser
 * fires an intersection callback for it — starts nothing. See this
 * ticket's report for the full no-autoplay interpretation.
 */
export function QuickFeedViewport({ children }: QuickFeedViewportProps) {
  const containerRef = useRef<HTMLUListElement>(null);
  const [activeLabel, setActiveLabel] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      return;
    }

    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-quick-feed-item]"));
    if (items.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) {
          return;
        }
        const mostVisible = visible.reduce((best, entry) =>
          entry.intersectionRatio > best.intersectionRatio ? entry : best,
        );
        const label = (mostVisible.target as HTMLElement).dataset.quickFeedLabel;
        if (label) {
          setActiveLabel(label);
        }
      },
      { root: container, threshold: [IN_VIEW_THRESHOLD] },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Announced once per settled item, not spammed per scroll frame —
          the observer above only fires on real intersection-ratio
          crossings, not on every pixel of scroll. */}
      <p role="status" aria-live="polite" className="sr-only">
        {activeLabel}
      </p>
      <ul
        ref={containerRef}
        aria-label="Feed Quick"
        className={cn(
          "flex flex-col overflow-y-auto overscroll-y-contain snap-y snap-mandatory motion-safe:scroll-smooth",
          QUICK_FEED_VIEWPORT_HEIGHT_CLASS,
          "md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:snap-none lg:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {children}
      </ul>
    </>
  );
}

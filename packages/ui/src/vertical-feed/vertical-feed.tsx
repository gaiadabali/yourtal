"use client";

import * as React from "react";
import { cn } from "../cn";
import { isCellularOrSaveData, readNavigatorConnection } from "./connection";

export type VerticalFeedMode = "teaser" | "inline-session";

export interface VerticalFeedItemState {
  /** This is the item currently snapped into view. */
  active: boolean;
  /** Within active ± 1 — the caller may render a real `<video>`; outside this window it must not. */
  mounted: boolean;
  index: number;
  /** Echoes the feed's own `mode`, so `renderItem` never needs its own closure over it. */
  mode: VerticalFeedMode;
}

export interface VerticalFeedProps<T extends { id: string }> {
  items: readonly T[];
  renderItem: (item: T, state: VerticalFeedItemState) => React.ReactNode;
  /** "teaser" feeds loop silently (see `VerticalFeedVideo`'s own `loop` prop); "inline-session" hosts a real watch session in place. */
  mode: VerticalFeedMode;
  /** Rendered as the final, always-poster-less panel — e.g. "You're all caught up". Copy is the caller's, so this stays bilingual. */
  endSlot: React.ReactNode;
  onActiveChange?: (index: number, item: T | undefined) => void;
  /** Accessible name for the scrollable region. */
  label: string;
  /**
   * Returns the URL to warm up when `item` becomes the *next* one (index
   * active+1) — its first 300 KB only, and only off cellular/data-saver.
   * Return undefined to skip preloading for that item.
   */
  preloadSrc?: (item: T) => string | undefined;
  className?: string;
}

/** `bytes=0-<END>` is 300 KB (300 * 1024 - 1), matching TASKS.md 3.5.a exactly. */
const PRELOAD_RANGE_END = 300 * 1024 - 1;
const MOUNT_RADIUS = 1;
const INTERSECTION_THRESHOLD = 0.6;

/**
 * A one-item-per-viewport vertical scroller (After Dark's "For You" feed):
 * native CSS scroll-snap for the scroll itself, an `IntersectionObserver` to
 * track which item settled into view, and a hard cap on how many neighbours
 * are ever reported "mounted" (active ± 1, so at most 3). This component
 * renders no `<video>` itself — `renderItem` decides what active/mounted
 * mean for its own media (see `VerticalFeedVideo`) — so it stays generic and
 * framework-free (no `next/*` import anywhere in this file).
 */
export function VerticalFeed<T extends { id: string }>({
  items,
  renderItem,
  mode,
  endSlot,
  onActiveChange,
  label,
  preloadSrc,
  className,
}: VerticalFeedProps<T>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [active, setActive] = React.useState(0);
  const preloadedIds = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      return;
    }
    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-vf-index]"));
    if (targets.length === 0) {
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
        const index = Number((mostVisible.target as HTMLElement).dataset["vfIndex"]);
        if (!Number.isNaN(index)) {
          setActive(index);
        }
      },
      { root: container, threshold: [INTERSECTION_THRESHOLD] },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [items.length]);

  React.useEffect(() => {
    onActiveChange?.(active, items[active]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `items` identity changes every render for inline arrays; only the active index and its own item matter here.
  }, [active]);

  // Warm up only the NEXT item, only its first 300 KB, only off cellular/saveData.
  React.useEffect(() => {
    const nextIndex = active + 1;
    const nextItem = items[nextIndex];
    if (!nextItem || !preloadSrc || preloadedIds.current.has(nextItem.id)) {
      return;
    }
    const src = preloadSrc(nextItem);
    if (!src) {
      return;
    }
    if (isCellularOrSaveData(readNavigatorConnection())) {
      return;
    }
    preloadedIds.current.add(nextItem.id);
    void fetch(src, { headers: { Range: `bytes=0-${PRELOAD_RANGE_END}` } }).catch(() => {
      // Best-effort warm-up only — a failed range request must never affect playback.
    });
  }, [active, items, preloadSrc]);

  const moveTo = React.useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), items.length);
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-vf-index="${clamped}"]`,
      );
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      setActive(clamped);
    },
    [items.length],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      moveTo(active + 1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      moveTo(active - 1);
    }
  };

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid="vertical-feed-scroller"
      onKeyDown={handleKeyDown}
      className={cn(
        "h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] motion-safe:scroll-smooth focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
        className,
      )}
    >
      {items.map((item, index) => {
        const state: VerticalFeedItemState = {
          active: index === active,
          mounted: Math.abs(index - active) <= MOUNT_RADIUS,
          index,
          mode,
        };
        return (
          <div key={item.id} data-vf-index={index} className="h-full w-full snap-start snap-always">
            {renderItem(item, state)}
          </div>
        );
      })}
      <div
        data-vf-index={items.length}
        className="flex h-full w-full snap-start snap-always flex-col items-center justify-center"
      >
        {endSlot}
      </div>
    </div>
  );
}

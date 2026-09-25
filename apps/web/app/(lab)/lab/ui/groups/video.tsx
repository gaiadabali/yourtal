"use client";

import * as React from "react";
import { PointsChip } from "@yourtal/ui/points-chip";
import { VerticalFeed } from "@yourtal/ui/vertical-feed";
import { VerticalFeedVideo } from "@yourtal/ui/vertical-feed/video";
import { VideoSurface } from "@/features/player/video-surface";
import { GalleryRow, GallerySection } from "../lib/gallery-section";
import { placeholderImage } from "../lib/placeholder-image";

interface DemoFeedItem {
  id: string;
  title: string;
  points: number;
}

const FEED_ITEMS: DemoFeedItem[] = Array.from({ length: 20 }, (_, index) => ({
  id: `demo-${index}`,
  title: `Campaign ${index + 1}`,
  points: 50 + index * 5,
}));

/**
 * VerticalFeed and VideoSurface (TASKS.md 3.5.a/b). Same-origin-only, on
 * purpose: the feed's clip src points at a path that does not exist so this
 * page never depends on the network — the poster (an inline SVG data URL,
 * same trick as every other gallery group) is what actually renders. That
 * also happens to be exactly what `apps/web/rendered/feed.spec.ts` checks:
 * scrolling through all 20 items keeps at most 3 `<video>` elements mounted
 * regardless of whether any of them can actually decode anything.
 */
export function VideoGroup() {
  return (
    <>
      <GallerySection
        id="vertical-feed"
        title="VerticalFeed"
        description="One item per viewport; at most 3 <video> elements mounted at once (active ± 1)."
      >
        <div className="h-[640px] w-full max-w-sm overflow-hidden rounded-card border border-border-subtle">
          <VerticalFeed
            items={FEED_ITEMS}
            mode="teaser"
            label="Demo For You feed"
            endSlot={
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <p className="text-title font-sans font-semibold text-fg">
                  You&apos;re all caught up
                </p>
                <p className="text-body-sm text-fg-muted">New campaigns land every morning.</p>
              </div>
            }
            renderItem={(item, state) => (
              <div className="relative h-full w-full">
                <VerticalFeedVideo
                  mounted={state.mounted}
                  active={state.active}
                  src="/lab/media/does-not-exist.mp4"
                  poster={placeholderImage(item.id, 480, 854)}
                  posterAlt=""
                  label={item.title}
                  playLabel={`Play ${item.title}`}
                  pauseLabel={`Pause ${item.title}`}
                  loop
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-body-sm font-sans font-semibold text-white">
                    {item.title}
                  </span>
                  <PointsChip
                    value={item.points}
                    prefix="+"
                    size="sm"
                    aria-label={`Plus ${item.points} points`}
                  />
                </div>
              </div>
            )}
          />
        </div>
      </GallerySection>

      <GallerySection
        id="video-surface"
        title="VideoSurface"
        description="A same-origin, always-404 source demonstrates the real error state; the CC toggle sits beside it."
      >
        <GalleryRow label="Error state and CC toggle">
          <div className="w-full max-w-lg">
            <VideoSurface
              src="/lab/media/does-not-exist.m3u8"
              label="Weekend bonus: 2x points"
              captionsSrc="/lab/media/does-not-exist.vtt"
              captionsToggleLabel="Captions"
              errorTitle="Playback failed"
              errorBody="Check your connection and try again."
              retryLabel="Retry"
            />
          </div>
        </GalleryRow>
      </GallerySection>
    </>
  );
}

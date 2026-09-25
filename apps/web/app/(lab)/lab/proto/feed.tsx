"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FEED, media, type Campaign, type FeedItem } from "./lab-data";
import { LabVideo } from "./lab-video";
import { useProto } from "./proto-context";
import { AfterDarkItem, DaylightItem, type ItemProps } from "./feed-items";

/**
 * The For You feed. Only the active item and its neighbours mount a <video>; the
 * rest are posters. Quick items earn in place once watched to the end.
 */
export function Feed({ onOpen }: { onOpen: (campaign: Campaign) => void }) {
  const { variant, earn } = useProto();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [earned, setEarned] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            setActive(Number((entry.target as HTMLElement).dataset["index"]));
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const onWatched = (item: FeedItem, origin: Element | null) => {
    if (item.campaign || earned.has(item.id)) return;
    setEarned((all) => new Set(all).add(item.id));
    earn(item.rewardPts, origin);
  };

  const Item = variant === "after-dark" ? AfterDarkItem : DaylightItem;
  return (
    <div
      ref={scroller}
      data-testid="feed"
      className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none]"
    >
      {FEED.map((item, index) => {
        const props: ItemProps = {
          item,
          active: index === active,
          earned: earned.has(item.id),
          onOpen,
          onWatched,
          media:
            Math.abs(index - active) <= 1 ? (
              <MountedVideo item={item} active={index === active} onWatched={onWatched} />
            ) : (
              <img
                src={media(item.clip, "jpg")}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ),
        };
        return (
          <div key={item.id} data-index={index} className="h-full snap-start snap-always">
            <Item {...props} />
          </div>
        );
      })}
      <div
        data-index={FEED.length}
        className="flex h-full snap-start flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-(--lab-surface-2)">
          <Check aria-hidden="true" className="text-(--lab-accent-text)" />
        </span>
        <p className="font-(family-name:--lab-display) text-2xl font-extrabold">
          You&apos;re all caught up
        </p>
        <p className="text-(--lab-fg-muted)">New campaigns land every morning.</p>
      </div>
    </div>
  );
}

function MountedVideo({
  item,
  active,
  onWatched,
}: {
  item: FeedItem;
  active: boolean;
  onWatched: (item: FeedItem, origin: Element | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const { variant } = useProto();
  return (
    <LabVideo
      captionsTop={variant === "after-dark"}
      ref={ref}
      clip={item.clip}
      active={active}
      loop
      label={`${item.channel.name}: ${item.title}`}
      fit={item.orientation === "horizontal" ? "contain" : "cover"}
      className="h-full w-full"
      onTime={(t, d) => {
        if (d && t >= d - 0.4) {
          const chip = ref.current?.closest("[data-item]")?.querySelector("[data-reward]") ?? null;
          onWatched(item, chip);
        }
      }}
    />
  );
}

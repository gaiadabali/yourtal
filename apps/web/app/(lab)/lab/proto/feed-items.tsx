"use client";

import { Bookmark, Check, Info, Volume2, VolumeX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ChannelAvatar, PointsChip } from "./bits";
import type { Campaign, FeedItem } from "./lab-data";
import { useProto } from "./proto-context";

export interface ItemProps {
  item: FeedItem;
  active: boolean;
  earned: boolean;
  media: ReactNode;
  onOpen: (campaign: Campaign) => void;
  onWatched: (item: FeedItem, origin: Element | null) => void;
}

function RewardLine({
  item,
  earned,
  onVideo,
}: {
  item: FeedItem;
  earned: boolean;
  onVideo: boolean;
}) {
  const muted = onVideo ? "text-white/85" : "text-(--lab-fg-muted)";
  if (item.campaign) {
    return (
      <span className={`flex items-center gap-2 text-sm ${muted}`}>
        <span data-reward>
          <PointsChip value={item.rewardPts} prefix="up to " size="sm" />
        </span>
        {item.durationLabel} · 1 question
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-2 text-sm ${muted}`}>
      <span data-reward>
        <PointsChip value={item.rewardPts} size="sm" />
      </span>
      {earned ? (
        <span className="inline-flex items-center gap-1 font-semibold">
          <Check size={14} aria-hidden="true" /> Earned
        </span>
      ) : (
        "Watch to the end to earn"
      )}
    </span>
  );
}

function RailButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}

function WatchButton({ campaign, onOpen }: { campaign: Campaign; onOpen: ItemProps["onOpen"] }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(campaign)}
      className="h-12 rounded-full bg-(--lab-accent) px-6 font-bold text-(--lab-fg-on-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lab-accent)"
    >
      Watch &amp; earn
    </button>
  );
}

/** Immersive: the UI floats over full-bleed video, actions on a right rail. */
export function AfterDarkItem({ item, earned, media, onOpen }: ItemProps) {
  const { muted, setMuted } = useProto();
  const [saved, setSaved] = useState(false);
  return (
    <article data-item aria-label={item.title} className="relative h-full overflow-hidden bg-black">
      <div className="absolute inset-0">{media}</div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-(image:--lab-scrim)" />
      <div className="absolute bottom-5 left-4 right-20 flex flex-col gap-2 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChannelAvatar channel={item.channel} size={28} />
          {item.channel.name}
        </span>
        <h2 className="font-(family-name:--lab-display) text-2xl leading-tight font-extrabold text-balance">
          {item.title}
        </h2>
        <RewardLine item={item} earned={earned} onVideo />
        {item.campaign ? (
          <div className="pt-1">
            <WatchButton campaign={item.campaign} onOpen={onOpen} />
          </div>
        ) : null}
      </div>
      <div className="absolute right-3 bottom-6 flex flex-col items-center gap-4">
        <RailButton label={`About ${item.channel.name}`}>
          <ChannelAvatar channel={item.channel} size={44} />
        </RailButton>
        <RailButton label="Save" pressed={saved} onClick={() => setSaved((s) => !s)}>
          <Bookmark aria-hidden="true" className={saved ? "fill-white" : ""} />
        </RailButton>
        <RailButton
          label={muted ? "Turn sound on" : "Turn sound off"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </RailButton>
        <RailButton label="Campaign details">
          <Info aria-hidden="true" />
        </RailButton>
      </div>
    </article>
  );
}

/** Framed: the media sits on a card and the UI below it. */
export function DaylightItem({ item, earned, media, onOpen }: ItemProps) {
  const { muted, setMuted } = useProto();
  const [saved, setSaved] = useState(false);
  return (
    <article
      data-item
      aria-label={item.title}
      className="flex h-full flex-col gap-3 px-4 pt-2 pb-4"
    >
      <header className="flex items-center gap-3">
        <ChannelAvatar channel={item.channel} size={36} />
        <span className="flex flex-col leading-tight">
          <span className="font-semibold">{item.channel.name}</span>
          <span className="text-sm text-(--lab-fg-muted)">
            {item.campaign ? "Campaign" : "Quick"} · {item.durationLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Save"
          aria-pressed={saved}
          onClick={() => setSaved((s) => !s)}
          className="ml-auto flex size-11 items-center justify-center rounded-full text-(--lab-fg) hover:bg-(--lab-surface-2)"
        >
          <Bookmark aria-hidden="true" className={saved ? "fill-current" : ""} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-black">
        {media}
        <button
          type="button"
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          onClick={() => setMuted(!muted)}
          className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full bg-black/55 text-white"
        >
          {muted ? (
            <VolumeX size={20} aria-hidden="true" />
          ) : (
            <Volume2 size={20} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="flex flex-col gap-2 rounded-3xl bg-(--lab-surface) p-4">
        <h2 className="font-(family-name:--lab-display) text-xl leading-tight font-extrabold text-balance">
          {item.title}
        </h2>
        <RewardLine item={item} earned={earned} onVideo={false} />
        {item.campaign ? <WatchButton campaign={item.campaign} onOpen={onOpen} /> : null}
      </div>
    </article>
  );
}

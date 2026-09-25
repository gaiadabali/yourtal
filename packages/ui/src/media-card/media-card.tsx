"use client";

import * as React from "react";
import { cn } from "../cn";
import { Progress } from "../progress/progress";

type MediaCardCore = {
  poster: string;
  posterAlt: string;
  aspect: "16:9" | "9:16";
  title: string;
  durationLabel?: string;
  channel?: React.ReactNode;
  reward?: React.ReactNode;
};

// A progress bar with no name is worse than no progress bar - see Progress's
// own required aria-label - so the label is only optional when there is no
// progress to show, never a silently-empty string.
type MediaCardProgress =
  { progress: number; progressLabel: string } | { progress?: never; progressLabel?: never };

type MediaCardContentProps = MediaCardCore & MediaCardProgress;

// On-image chrome (scrim, duration chip) sits on an arbitrary photo, not the
// app surface, so it stays a fixed dark-on-light pairing in every theme -
// bg-overlay is already theme-invariant; white text is the one deliberate
// exception to "tokens only", matching the founder-approved reference.
function MediaCardBody({
  poster,
  posterAlt,
  aspect,
  title,
  durationLabel,
  channel,
  reward,
  progress,
  progressLabel,
}: MediaCardContentProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card bg-surface-sunken",
        aspect === "16:9" ? "aspect-video" : "aspect-[9/16]",
      )}
    >
      <img src={poster} alt={posterAlt} loading="lazy" className="h-full w-full object-cover" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-overlay to-transparent"
      />
      {durationLabel ? (
        <span className="absolute top-2 right-2 rounded-control bg-overlay px-1.5 py-0.5 text-caption font-sans font-medium text-white">
          {durationLabel}
        </span>
      ) : null}
      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5 text-white">
        {channel}
        <span className="line-clamp-2 font-display text-title font-bold text-balance">{title}</span>
        {reward}
      </div>
      {typeof progress === "number" ? (
        <div className="absolute inset-x-0 bottom-0">
          <Progress
            value={Math.round(progress * 100)}
            max={100}
            aria-label={progressLabel}
            className="h-1 rounded-none bg-white/25"
          />
        </div>
      ) : null}
    </div>
  );
}

type MediaCardTarget =
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
  | { href?: never; onClick?: never };

/**
 * A video tile: poster, scrim, duration/progress chrome and title all live on
 * the image (matching the After Dark reference), with the channel and reward
 * slots left to the caller so copy and translation stay outside this package.
 * Becomes a single link or button target only when the caller opts in.
 */
export type MediaCardProps = MediaCardContentProps & MediaCardTarget & { className?: string };

export const MediaCard = React.forwardRef<HTMLElement, MediaCardProps>((props, ref) => {
  const { className, href, onClick, ...content } = props;
  const sharedClassName = cn(
    "group block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    className,
  );

  if (href) {
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={sharedClassName}>
        <MediaCardBody {...content} />
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={onClick}
        className={sharedClassName}
      >
        <MediaCardBody {...content} />
      </button>
    );
  }
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={sharedClassName}>
      <MediaCardBody {...content} />
    </div>
  );
});
MediaCard.displayName = "MediaCard";

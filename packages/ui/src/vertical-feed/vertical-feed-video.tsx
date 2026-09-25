"use client";

import * as React from "react";
import { cn } from "../cn";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

export interface VerticalFeedVideoProps {
  /** Only ever a real `<video>` when true (the feed's active ± 1 window) — an `<img>` poster otherwise. */
  mounted: boolean;
  /** This is the item currently snapped into view; it is the only one ever allowed to play. */
  active: boolean;
  src: string;
  poster: string;
  posterAlt: string;
  /** Accessible name for the `<video>` element itself. */
  label: string;
  /** Accessible name for the tap target while the video is paused (or hasn't started). No baked-in copy — the app is bilingual. */
  playLabel: string;
  /** Accessible name for the tap target while the video is playing. */
  pauseLabel: string;
  /** Teaser feeds loop; a full watch session does not. */
  loop?: boolean;
  captionsSrc?: string;
  /** Accessible name for the caption track. Defaults to "Captions" — pass a translated string for anything user-facing. */
  captionsLabel?: string;
  /** Sound is off by default (teaser feeds autoplay silently); captions show automatically while muted. */
  muted?: boolean;
  className?: string;
}

/**
 * The one place a real `<video>` element exists in a `VerticalFeed` — never
 * rendered unless `mounted` (see `vertical-feed.tsx`'s active ± 1 cap), so a
 * caller cannot accidentally exceed 3 mounted videos just by passing this
 * component to every item's `renderItem`.
 *
 * No autoplay under `prefers-reduced-motion`: the first play is always a tap
 * (mirrors the founder-approved lab prototype's `LabVideo`, minus its
 * lab-only prototype context). Once the viewer has tapped once, subsequent
 * `active` transitions do resume playback — reduced motion means "don't
 * start motion on my behalf", not "prevent me from choosing to watch".
 */
export const VerticalFeedVideo = React.forwardRef<HTMLVideoElement | null, VerticalFeedVideoProps>(
  function VerticalFeedVideo(
    {
      mounted,
      active,
      src,
      poster,
      posterAlt,
      label,
      playLabel,
      pauseLabel,
      loop = false,
      captionsSrc,
      captionsLabel = "Captions",
      muted = true,
      className,
    },
    ref,
  ) {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const [paused, setPaused] = React.useState(false);
    const [started, setStarted] = React.useState(false);
    const reducedMotion = usePrefersReducedMotion();
    React.useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    const wantsPlay = mounted && active && !paused && (started || !reducedMotion);

    React.useEffect(() => {
      const el = videoRef.current;
      if (!el) {
        return;
      }
      if (wantsPlay) {
        void el.play().catch(() => setPaused(true));
      } else {
        el.pause();
      }
    }, [wantsPlay]);

    React.useEffect(() => {
      if (!active) {
        setPaused(false);
        setStarted(false);
      }
    }, [active]);

    React.useEffect(() => {
      const track = videoRef.current?.textTracks[0];
      if (track) {
        track.mode = muted ? "showing" : "hidden";
      }
    }, [muted, mounted]);

    const toggle = () => {
      setStarted(true);
      setPaused((current) => (reducedMotion && !started ? false : !current));
    };

    if (!mounted) {
      return (
        <img
          src={poster}
          alt={posterAlt}
          loading="lazy"
          className={cn("h-full w-full object-cover", className)}
        />
      );
    }

    return (
      <div className={cn("relative h-full w-full overflow-hidden bg-canvas", className)}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          muted={muted}
          playsInline
          loop={loop}
          preload={active ? "auto" : "none"}
          aria-label={label}
          className="h-full w-full object-cover"
        >
          {captionsSrc ? (
            <track kind="captions" src={captionsSrc} srcLang="en" label={captionsLabel} default />
          ) : null}
        </video>
        <button
          type="button"
          onClick={toggle}
          aria-label={wantsPlay ? pauseLabel : playLabel}
          className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
        />
      </div>
    );
  },
);

"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Captions, CaptionsOff } from "lucide-react";
import { Button } from "@yourtal/ui/button";
import { cn } from "@yourtal/ui/cn";
import { isCellularConnection, readNavigatorConnection } from "./network-connection";
import {
  MAX_AUTO_HEIGHT,
  defaultVideoSurfaceQualityId,
  getVideoSurfaceQualityTier,
  type VideoSurfaceQualityId,
} from "./video-surface-quality";

// Loaded on intent only, never server-rendered — see hls-attacher.tsx's own
// doc comment for why this dynamic import is what keeps the ~340 KB hls.js
// chunk out of any route's initial JS. `video-player.tsx` uses the exact
// same pattern for the exact same file; VideoSurface is a second, separate
// caller, not a change to that one.
const HlsAttacher = dynamic(() => import("./hls-attacher").then((mod) => mod.HlsAttacher), {
  ssr: false,
});

/**
 * Feature-detected on a throwaway, never-mounted element rather than a ref
 * to the real `<video>` in an effect — that would leave one render where
 * `nativeHls` is still its initial `false`, mounting `HlsAttacher` for a
 * Safari viewer for a moment before the effect corrects it. `canPlayType`
 * needs no DOM attachment at all, so this resolves synchronously, in the
 * lazy `useState` initializer, before anything is ever rendered.
 */
function supportsNativeHls(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
}

export interface VideoSurfaceProps {
  /** HLS manifest URL. */
  src: string;
  poster?: string;
  /** Accessible name for the `<video>` element. */
  label: string;
  captionsSrc?: string;
  /** Accessible name for the CC toggle button (e.g. "Captions"). No baked-in copy — the app is bilingual. */
  captionsToggleLabel: string;
  errorTitle: string;
  errorBody: string;
  retryLabel: string;
  /**
   * Overrides the connection-based default (360p cellular / 540p otherwise).
   * VideoSurface renders no quality-picker UI itself — this is the seam a
   * caller's own selector (e.g. a `QualitySelector`-like control) drives.
   */
  quality?: VideoSurfaceQualityId;
  className?: string;
}

/**
 * The primitive the watch page adopts in Phase 5/6 (TASKS.md 3.5.b) —
 * `video-player.tsx` and its behaviour are untouched by this file. Starts at
 * 360p on a positively-identified cellular connection, 540p otherwise
 * (`video-surface-quality.ts`), and never offers a rendition above 720p —
 * the ladder itself has no tier past that, so "unless the viewer chooses" a
 * higher one is structurally impossible, not just policy.
 */
export function VideoSurface({
  src,
  poster,
  label,
  captionsSrc,
  captionsToggleLabel,
  errorTitle,
  errorBody,
  retryLabel,
  quality,
  className,
}: VideoSurfaceProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [nativeHls] = React.useState(supportsNativeHls);
  const [hasError, setHasError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [showCaptions, setShowCaptions] = React.useState(false);
  // Computed once, from the connection at mount — "starts at" (TASKS.md
  // 3.5.b), not "keeps reacting to the connection forever". A `useRef` lazy
  // init rather than `useState`'s so a later `quality` prop always wins
  // without this default ever needing to change on its own.
  const defaultQualityId = React.useRef<VideoSurfaceQualityId | null>(null);
  defaultQualityId.current ??= defaultVideoSurfaceQualityId(
    isCellularConnection(readNavigatorConnection()),
  );
  const qualityId = quality ?? defaultQualityId.current;

  React.useEffect(() => {
    const track = videoRef.current?.textTracks[0];
    if (track) {
      track.mode = showCaptions ? "showing" : "hidden";
    }
  }, [showCaptions, nativeHls, attempt]);

  const retry = () => {
    setHasError(false);
    setAttempt((current) => current + 1);
    if (nativeHls) {
      videoRef.current?.load();
    }
  };

  const desiredHeight = Math.min(
    getVideoSurfaceQualityTier(qualityId).resolutionHeight,
    MAX_AUTO_HEIGHT,
  );

  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-lg bg-fg", className)}>
      {/*
        No native `controls`: play/pause/seek chrome is composed around this
        primitive by its caller (the future watch page), the same split
        `video-player.tsx` already uses with its own `PlayerControls`. This
        component's job is only the media element, HLS attachment, the error
        state and the CC toggle.
      */}
      <video
        key={attempt}
        ref={videoRef}
        className="h-full w-full"
        poster={poster}
        src={nativeHls ? src : undefined}
        playsInline
        aria-label={label}
      >
        {captionsSrc ? (
          <track kind="captions" src={captionsSrc} srcLang="en" label="English" />
        ) : null}
      </video>

      {!nativeHls && !hasError ? (
        <HlsAttacher
          videoRef={videoRef}
          src={src}
          desiredHeight={desiredHeight}
          onFatalError={() => setHasError(true)}
        />
      ) : null}

      <div className="absolute top-2 right-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-pressed={showCaptions}
          aria-label={captionsToggleLabel}
          onClick={() => setShowCaptions((current) => !current)}
        >
          {showCaptions ? (
            <Captions aria-hidden="true" className="size-4" />
          ) : (
            <CaptionsOff aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>

      {hasError ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-fg/90 p-6 text-center text-fg-on-accent"
        >
          <p className="text-title font-sans font-semibold">{errorTitle}</p>
          <p className="text-body-sm">{errorBody}</p>
          <Button type="button" variant="secondary" onClick={retry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

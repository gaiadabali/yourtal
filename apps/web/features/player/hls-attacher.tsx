"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import Hls from "hls.js";

/**
 * The only file in this feature that imports "hls.js" statically. It is
 * NEVER imported statically by anything else — `video-player.tsx` reaches
 * it exclusively through `next/dynamic(() => import("./hls-attacher"), {
 * ssr: false })`, and only mounts the result after the user taps play
 * (docs/13b-typescript-standards.md §8 names hls.js as exactly this case).
 * That keeps the ~340 KB hls.js chunk out of the route's initial JS
 * entirely — it is fetched on intent, not on page load, and never
 * server-rendered (there is nothing to render; this component returns
 * null and only attaches to an existing <video> element).
 *
 * Safari is never routed here at all — `use-watch-session.ts` feature-
 * detects native HLS support (`video.canPlayType(...)`) before deciding
 * whether to mount this component, so Safari users never pay for the
 * hls.js chunk either.
 */
export interface HlsAttacherProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  /** Target rendition height (e.g. 480 for the "480p" tier). Re-applied whenever it changes. */
  desiredHeight: number;
  onFatalError?: (message: string) => void;
}

export function HlsAttacher({ videoRef, src, desiredHeight, onFatalError }: HlsAttacherProps) {
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (!Hls.isSupported()) {
      onFatalError?.("HLS playback is not supported in this browser.");
      return;
    }

    const hls = new Hls({ capLevelToPlayerSize: false });
    hlsRef.current = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => applyDesiredLevel(hls, desiredHeight));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        onFatalError?.(`Playback error: ${data.details}`);
      }
    });
    hls.loadSource(src);
    hls.attachMedia(video);

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- desiredHeight is applied by the effect below, not re-run here; re-attaching on every quality change would restart the stream.
  }, [src, videoRef, onFatalError]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (hls) {
      applyDesiredLevel(hls, desiredHeight);
    }
  }, [desiredHeight]);

  return null;
}

/** Forces (not merely suggests) the nearest-by-height rendition — docs/06 §2.3 rule 1: "never let ABR climb on its own." */
function applyDesiredLevel(hls: Hls, desiredHeight: number): void {
  if (hls.levels.length === 0) {
    return;
  }
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  hls.levels.forEach((level, index) => {
    const diff = Math.abs(level.height - desiredHeight);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  hls.currentLevel = bestIndex;
}

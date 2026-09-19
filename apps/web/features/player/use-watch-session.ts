"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Chapter } from "./chapter";
import { DEFAULT_QUALITY_TIER_ID, type QualityTierId } from "./quality-tier";
import { MIN_RESUMABLE_SECONDS, clearResumePosition, readResumePosition } from "./resume-position";
import { toRealSeconds } from "./time-remap";
import { useVideoEventWiring } from "./use-video-event-wiring";

export interface ResumeOffer {
  positionSeconds: number;
}

export interface WatchSession {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasStarted: boolean;
  useNativeHls: boolean;
  isPlaying: boolean;
  /** See `VideoEventWiringState.hasEnded` in `use-video-event-wiring.ts` for what this really means (YT-0551) — it is no longer driven by the DOM `ended` event. */
  hasEnded: boolean;
  /** Playback position remapped onto the campaign's own advertised duration — see time-remap.ts. */
  virtualCurrentTime: number;
  qualityTierId: QualityTierId;
  setQualityTierId: (id: QualityTierId) => void;
  reachedChapterIndex: number;
  accruedPoints: number;
  isBackgrounded: boolean;
  resumeOffer: ResumeOffer | null;
  dismissResumeOffer: (choice: "resume" | "restart") => void;
  handlePlay: () => void;
  handlePause: () => void;
  handleSeekTo: (virtualSeconds: number) => void;
  manifestUrl: string;
}

/**
 * Owns all watch-session state and video-element wiring, so `video-player.tsx`
 * stays markup + composition (docs/13-engineering-standards.md §2: "3+
 * useState plus an effect -> extract hook"). The native `<video>` event
 * listeners, coverage tracking (YT-0551) and resume-position writes live in
 * `use-video-event-wiring.ts` — split out to keep both files under the
 * 300-line ceiling (§1) once that ticket's fraud-control logic landed here.
 */
export function useWatchSession(
  campaign: Campaign,
  chapters: readonly Chapter[],
  isBackgrounded: boolean,
): WatchSession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [useNativeHls, setUseNativeHls] = useState(false);
  const [qualityTierId, setQualityTierId] = useState<QualityTierId>(DEFAULT_QUALITY_TIER_ID);
  const [resumeOffer, setResumeOffer] = useState<ResumeOffer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  // YT-0550 — coalesces rapid seek requests (keyboard repeat, a fast drag)
  // that arrive while a previous seek against the network origin is still
  // resolving. Only the latest target survives; it is applied once the
  // in-flight seek actually settles (`flushQueuedSeek`, consumed by
  // `use-video-event-wiring.ts`'s `seeked` handler). See handleSeekTo's own
  // comment for why this exists.
  const queuedSeekRef = useRef<number | null>(null);

  // One-time lookup on mount. A missing/corrupt entry (already Zod-validated
  // by resume-position.ts) yields null, so this never blocks playback.
  useEffect(() => {
    const prior = readResumePosition(campaign.id);
    if (
      prior &&
      prior.positionSeconds >= MIN_RESUMABLE_SECONDS &&
      prior.positionSeconds < campaign.durationSeconds
    ) {
      setResumeOffer({ positionSeconds: prior.positionSeconds });
    }
  }, [campaign.id, campaign.durationSeconds]);

  const dismissResumeOffer = useCallback(
    (choice: "resume" | "restart") => {
      if (choice === "resume") {
        setResumeOffer((current) => {
          pendingSeekRef.current = current?.positionSeconds ?? 0;
          return null;
        });
      } else {
        pendingSeekRef.current = 0;
        clearResumePosition(campaign.id);
        setResumeOffer(null);
      }
    },
    [campaign.id],
  );

  const applyPendingSeek = useCallback(() => {
    const video = videoRef.current;
    if (
      !video ||
      pendingSeekRef.current === null ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0
    ) {
      return;
    }
    video.currentTime = toRealSeconds(
      pendingSeekRef.current,
      video.duration,
      campaign.durationSeconds,
    );
    pendingSeekRef.current = null;
  }, [campaign.durationSeconds]);

  const applyRealSeek = useCallback(
    (video: HTMLVideoElement, virtualSeconds: number) => {
      video.currentTime = toRealSeconds(virtualSeconds, video.duration, campaign.durationSeconds);
    },
    [campaign.durationSeconds],
  );

  const flushQueuedSeek = useCallback(
    (video: HTMLVideoElement) => {
      const queued = queuedSeekRef.current;
      if (queued !== null) {
        queuedSeekRef.current = null;
        applyRealSeek(video, queued);
      }
    },
    [applyRealSeek],
  );

  /**
   * YT-0550. `Home` was landing at 0.35 s instead of zero, only against the
   * MinIO origin and never against a same-process static file — a standalone
   * probe seeking to 0 lands exactly there, and `toRealSeconds(0, ...)` is
   * exactly 0 for any duration, so the arithmetic was never the bug.
   *
   * The remaining candidate is the one this file's own keyboard-seek test
   * comment already named: repeat keypresses (or a fast drag) call this
   * function many times in quick succession, each assigning `currentTime`
   * again before the browser's previous seek against the network origin has
   * resolved. Overlapping in-flight fragment loads can then settle out of
   * order, and hls.js's own gap/nudge handling can nudge `currentTime`
   * forward *after* a later, intended target was already set — which is
   * indistinguishable from "the last seek didn't really take".
   *
   * The fix coalesces: while `video.seeking` is true, a new request replaces
   * whatever target was queued rather than issuing a second overlapping
   * seek, and the queued target is applied once `seeked` reports the current
   * one settled (`flushQueuedSeek`, in `use-video-event-wiring.ts`).
   * Repeated presses collapse into far fewer real seeks, and by the time any
   * one of them is reported settled there is at most one target still
   * queued, applied cleanly.
   *
   * Not verified against the real origin in this pass — this repo's own
   * incident log (docs/13c, "Two agents, one working tree") is why: a
   * `next build` run here would share `.next` with another session's live
   * `next dev`, which is exactly the corruption that entry describes. The
   * fix is reasoned from the failure's own description and covered by a
   * unit test of the coalescing behaviour (`use-watch-session.test.tsx`);
   * `keyboard-seek.spec.ts`'s `Home` case is left `test.fixme` for a session
   * that can run `pnpm dev:up && pnpm media:publish` and the real Playwright
   * suite to confirm and flip it.
   */
  const handleSeekTo = useCallback(
    (virtualSeconds: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
        pendingSeekRef.current = virtualSeconds;
        return;
      }
      if (video.seeking) {
        queuedSeekRef.current = virtualSeconds;
        return;
      }
      applyRealSeek(video, virtualSeconds);
    },
    [applyRealSeek],
  );

  const handlePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (!hasStarted) {
      // Safari plays HLS natively; feature-detect and skip hls.js entirely
      // for it (docs/13b-typescript-standards.md §8).
      const native = video.canPlayType("application/vnd.apple.mpegurl") !== "";
      setUseNativeHls(native);
      setHasStarted(true);
      if (native) {
        video.src = campaign.videoSource.manifestUrl;
      }
    }
    video.play().then(
      () => undefined,
      () => {
        // Rejected without a genuine user gesture, or the browser isn't
        // ready yet — leave paused, the user can tap again. `isPlaying`
        // itself comes from the video element's own `play`/`pause` events
        // (use-video-event-wiring.ts), not from this promise settling.
      },
    );
  }, [hasStarted]);

  const handlePause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const { isPlaying, hasEnded, virtualCurrentTime } = useVideoEventWiring({
    videoRef,
    campaign,
    onLoadedMetadata: applyPendingSeek,
    flushQueuedSeek,
  });

  const reachedChapterIndex = chapters.reduce(
    (acc, chapter, index) => (virtualCurrentTime >= chapter.endSeconds ? index : acc),
    -1,
  );
  const accruedPoints = chapters
    .slice(0, reachedChapterIndex + 1)
    .reduce((sum, chapter) => sum + chapter.rewardPoints, 0);

  return {
    videoRef,
    hasStarted,
    useNativeHls,
    isPlaying,
    hasEnded,
    virtualCurrentTime,
    qualityTierId,
    setQualityTierId,
    reachedChapterIndex,
    accruedPoints,
    isBackgrounded,
    resumeOffer,
    dismissResumeOffer,
    handlePlay,
    handlePause,
    handleSeekTo,
    manifestUrl: campaign.videoSource.manifestUrl,
  };
}

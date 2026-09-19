"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { CoverageInterval } from "@yourtal/contracts/watch/coverage";
import { clearResumePosition, writeResumePosition } from "./resume-position";
import { toVirtualSeconds } from "./time-remap";
import { applyCoverageTick, hasFullRealCoverage } from "./watch-coverage-tracker";

const RESUME_WRITE_INTERVAL_MS = 5_000;

export interface VideoEventWiringState {
  isPlaying: boolean;
  /**
   * Named for its consumers (`CompletionHandoff`, `OpenViewSignupPrompt`)
   * rather than renamed with this fix — but despite the name, this is no
   * longer driven by the DOM `ended` event. YT-0551: it reflects whether the
   * whole timeline has been *covered* by real playback ticks, recomputed on
   * every tick and on `ended` alike. See `watch-coverage-tracker.ts` for why,
   * and for why this is defence in depth rather than the actual control —
   * the server refuses an incomplete claim regardless of what this flag says.
   */
  hasEnded: boolean;
  /** Playback position remapped onto the campaign's own advertised duration — see time-remap.ts. */
  virtualCurrentTime: number;
}

export interface VideoEventWiringDeps {
  videoRef: RefObject<HTMLVideoElement | null>;
  campaign: Campaign;
  /** Applies a resume seek queued before the video had a finite duration. */
  onLoadedMetadata: () => void;
  /** YT-0550: applies whatever seek target was coalesced while this one was in flight, if any. */
  flushQueuedSeek: (video: HTMLVideoElement) => void;
}

/**
 * Owns every native `<video>` event listener: coverage tracking (YT-0551),
 * resume-position writes, and the playback state `video-player.tsx` renders
 * from. Split out of `use-watch-session.ts` to keep both files under
 * docs/13-engineering-standards.md §1's 300-line ceiling — this effect was
 * the "handler does parse -> ... -> emit" shape that standard names as
 * "extract the middle", so the tick-processing/listener wiring is now
 * readable apart from the seek-coalescing and resume-offer orchestration
 * that calls into it.
 */
export function useVideoEventWiring({
  videoRef,
  campaign,
  onLoadedMetadata,
  flushQueuedSeek,
}: VideoEventWiringDeps): VideoEventWiringState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [virtualCurrentTime, setVirtualCurrentTime] = useState(0);

  // YT-0551 — coverage tracking. `coverageRef` holds real-second intervals
  // actually played (watch-coverage-tracker.ts); `lastRealTimeRef` is the
  // pointer each tick is measured from; `seekPendingRef` is set by the
  // `seeking` listener and consumed by the next tick, so that tick is known
  // to be a jump's landing spot, never credited as playback.
  const coverageRef = useRef<readonly CoverageInterval[]>([]);
  const lastRealTimeRef = useRef(0);
  const seekPendingRef = useRef(false);
  const lastResumeWriteAtRef = useRef(0);

  // A campaign change must not inherit another campaign's tracked coverage.
  // In practice the player remounts on a route change anyway, but this
  // hook's own state should not depend on that.
  useEffect(() => {
    coverageRef.current = [];
    lastRealTimeRef.current = 0;
    seekPendingRef.current = false;
  }, [campaign.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    /**
     * One tick of ground truth, shared by `timeupdate`, `seeked` and
     * `ended` — completion is asked fresh every time, never assumed from
     * which event fired. `seekPendingRef` tells `applyCoverageTick` whether
     * this tick is a jump's landing spot rather than played time; either
     * way the pointer advances so the next tick is measured from here.
     */
    function recordTick() {
      const current = videoRef.current;
      if (!current || !Number.isFinite(current.duration) || current.duration <= 0) {
        return;
      }
      coverageRef.current = applyCoverageTick(coverageRef.current, {
        previousRealSeconds: lastRealTimeRef.current,
        currentRealSeconds: current.currentTime,
        followsSeek: seekPendingRef.current,
      });
      lastRealTimeRef.current = current.currentTime;
      seekPendingRef.current = false;
      setHasEnded(hasFullRealCoverage(coverageRef.current, current.duration));

      const virtual = toVirtualSeconds(
        current.currentTime,
        current.duration,
        campaign.durationSeconds,
      );
      setVirtualCurrentTime(virtual);

      const now = Date.now();
      if (now - lastResumeWriteAtRef.current > RESUME_WRITE_INTERVAL_MS) {
        lastResumeWriteAtRef.current = now;
        writeResumePosition({
          campaignId: campaign.id,
          positionSeconds: virtual,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    function onTimeUpdate() {
      recordTick();
    }
    function onSeeking() {
      seekPendingRef.current = true;
    }
    function onSeeked() {
      recordTick();
      // YT-0550: the seek this tick reports has now genuinely settled.
      const current = videoRef.current;
      if (current && !current.seeking) {
        flushQueuedSeek(current);
      }
    }
    function onPlay() {
      setIsPlaying(true);
    }
    function onPause() {
      setIsPlaying(false);
    }
    function onEnded() {
      setIsPlaying(false);
      // Deliberately not `setHasEnded(true)` — see this module's `hasEnded`
      // doc comment and watch-coverage-tracker.ts. `recordTick` asks the
      // coverage the same question it asks on every other tick, so a
      // synthetic `video.dispatchEvent(new Event("ended"))` — which
      // produces no coverage at all — changes nothing here.
      recordTick();
      const current = videoRef.current;
      if (current && hasFullRealCoverage(coverageRef.current, current.duration)) {
        clearResumePosition(campaign.id);
      }
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeking", onSeeking);
    // `seeked` as well as `timeupdate`, and this is an accessibility fix
    // rather than a tidy-up. `timeupdate` only fires while the media is
    // advancing, so a PAUSED viewer who scrubs — with the arrow keys, Home
    // or End on the seek bar — moved `video.currentTime` but saw nothing
    // move on screen, because this state never updated and the controlled
    // input reverted to its old value. That is precisely the viewer who
    // depends on keyboard seeking. Found once the player had a video that
    // actually loads; it was invisible while the placeholder stream never
    // reported a duration.
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef, campaign.id, campaign.durationSeconds, onLoadedMetadata, flushQueuedSeek]);

  return { isPlaying, hasEnded, virtualCurrentTime };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Chapter } from "./chapter";
import { DEFAULT_QUALITY_TIER_ID, type QualityTierId } from "./quality-tier";
import {
  MIN_RESUMABLE_SECONDS,
  clearResumePosition,
  readResumePosition,
  writeResumePosition,
} from "./resume-position";
import { toRealSeconds, toVirtualSeconds } from "./time-remap";
import { MOCK_HLS_MANIFEST_URL } from "./video-source";

const RESUME_WRITE_INTERVAL_MS = 5_000;

export interface ResumeOffer {
  positionSeconds: number;
}

export interface WatchSession {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasStarted: boolean;
  useNativeHls: boolean;
  isPlaying: boolean;
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
 * useState plus an effect -> extract hook").
 */
export function useWatchSession(
  campaign: Campaign,
  chapters: readonly Chapter[],
  isBackgrounded: boolean,
): WatchSession {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [useNativeHls, setUseNativeHls] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [virtualCurrentTime, setVirtualCurrentTime] = useState(0);
  const [qualityTierId, setQualityTierId] = useState<QualityTierId>(DEFAULT_QUALITY_TIER_ID);
  const [resumeOffer, setResumeOffer] = useState<ResumeOffer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const lastResumeWriteAtRef = useRef(0);

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

  const handleSeekTo = useCallback(
    (virtualSeconds: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
        pendingSeekRef.current = virtualSeconds;
        return;
      }
      video.currentTime = toRealSeconds(virtualSeconds, video.duration, campaign.durationSeconds);
    },
    [campaign.durationSeconds],
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
        video.src = MOCK_HLS_MANIFEST_URL;
      }
    }
    video.play().then(
      () => setIsPlaying(true),
      () => {
        // Rejected without a genuine user gesture, or the browser isn't
        // ready yet — leave paused, the user can tap again.
      },
    );
  }, [hasStarted]);

  const handlePause = useCallback(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    function onLoadedMetadata() {
      applyPendingSeek();
    }
    function onTimeUpdate() {
      const current = videoRef.current;
      if (!current || !Number.isFinite(current.duration) || current.duration <= 0) {
        return;
      }
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
    function onPlay() {
      setIsPlaying(true);
      setHasEnded(false);
    }
    function onPause() {
      setIsPlaying(false);
    }
    function onEnded() {
      setIsPlaying(false);
      setHasEnded(true);
      clearResumePosition(campaign.id);
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [applyPendingSeek, campaign.durationSeconds, campaign.id]);

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
    manifestUrl: MOCK_HLS_MANIFEST_URL,
  };
}

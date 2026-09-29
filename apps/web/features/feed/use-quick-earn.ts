"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { completeWatchAction, reportWatchProgressAction, startWatchAction } from "./feed-actions";

export type QuickEarnPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "watching"; sessionId: string; manifestUrl: string; durationSeconds: number }
  | { kind: "claiming" }
  | { kind: "earned"; points: number; unlockAt: string | null }
  | { kind: "not_earning"; alreadyEarned: boolean }
  /** 12.2.b: a teen's own quiet hours (21:00-07:00) refused a NEW reward session — kindly, not as a generic failure. */
  | { kind: "quiet_hours" }
  | { kind: "failed" };

// Real time between reports. The server refuses anything faster than real time.
const REPORT_EVERY_MS = 5_000;

/**
 * An in-feed reward session for a quick campaign (11.4.b, F15). The client
 * only reports what it played; the server decides from coverage whether it
 * was watched. Spans start at the last whole second reported, because the
 * server rounds each span inward and back-to-back fractional spans would
 * leave one-second holes.
 */
export function useQuickEarn(campaignId: string) {
  const [phase, setPhase] = useState<QuickEarnPhase>({ kind: "idle" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reportedTo = useRef(0);
  const sending = useRef<Promise<unknown> | null>(null);

  const start = useCallback(async () => {
    setPhase({ kind: "starting" });
    const started = await startWatchAction(campaignId);
    if (!started.ok) {
      setPhase(
        started.error.kind === "http" && started.error.code === "teen_quiet_hours"
          ? { kind: "quiet_hours" }
          : { kind: "failed" },
      );
      return;
    }
    const { session, alreadyEarned, manifestUrl, durationSeconds } = started.data;
    if (session.nonEarning) {
      setPhase({ kind: "not_earning", alreadyEarned });
      return;
    }
    reportedTo.current = 0;
    setPhase({ kind: "watching", sessionId: session.id, manifestUrl, durationSeconds });
  }, [campaignId]);

  const sessionId = phase.kind === "watching" ? phase.sessionId : null;
  const durationSeconds = phase.kind === "watching" ? phase.durationSeconds : 0;

  const report = useCallback(
    async (toSeconds: number) => {
      if (sessionId === null) return;
      const from = Math.floor(reportedTo.current);
      const to = Math.min(durationSeconds, toSeconds);
      if (to - from < 1) return;
      const pending = reportWatchProgressAction(sessionId, from, to);
      sending.current = pending;
      const result = await pending;
      if (result.ok && result.data.accepted) reportedTo.current = to;
    },
    [sessionId, durationSeconds],
  );

  // Report while playing; hold the rate at 1 and pause when the tab is hidden (EW-14).
  useEffect(() => {
    const video = videoRef.current;
    if (sessionId === null || !video) return;
    const timer = window.setInterval(() => {
      if (!video.paused && !video.ended) void report(video.currentTime);
    }, REPORT_EVERY_MS);
    const holdRate = () => {
      if (video.playbackRate !== 1) video.playbackRate = 1;
    };
    const onHidden = () => {
      if (document.hidden) video.pause();
    };
    video.addEventListener("ratechange", holdRate);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("ratechange", holdRate);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [sessionId, report]);

  const finish = useCallback(async () => {
    if (sessionId === null) return;
    await sending.current;
    // The video ended, so the whole length was played through.
    await report(durationSeconds);
    setPhase({ kind: "claiming" });
    const completed = await completeWatchAction(sessionId);
    if (!completed.ok) {
      setPhase({ kind: "failed" });
      return;
    }
    setPhase(
      completed.data.granted
        ? {
            kind: "earned",
            points: completed.data.pendingPoints,
            unlockAt: completed.data.unlockAt ?? null,
          }
        : { kind: "not_earning", alreadyEarned: completed.data.reason === "already_earned" },
    );
  }, [sessionId, durationSeconds, report]);

  return { phase, start, finish, videoRef };
}

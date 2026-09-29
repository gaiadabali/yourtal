"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { questionsAskedFor } from "./question-schedule";
import {
  answerCheckpointAction,
  completeWatchSessionAction,
  presentCheckpointAction,
  reportWatchProgressAction,
  startWatchSessionAction,
} from "./watch-player-actions";

export type WatchEarnPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "watching";
      sessionId: string;
      manifestUrl: string;
      durationSeconds: number;
      totalQuestions: number;
      /** `false` for a repeat visit (already earned) or an unfunded campaign — the video still plays, nothing is tracked toward a reward. */
      earning: boolean;
      /** Server-confirmed coverage (EW-15) — never the raw playhead. */
      coveredSeconds: number;
    }
  | {
      kind: "checkpoint";
      sessionId: string;
      checkpointIndex: number;
      totalQuestions: number;
      question: PresentedQuestion;
      token: string;
      answerTimerMs: number;
    }
  | { kind: "claiming" }
  | { kind: "earned"; points: number; unlockAt: string | null }
  | { kind: "not_earning"; reason: string | null }
  | { kind: "failed" };

const REPORT_EVERY_MS = 4_000;

/**
 * The real reward session for the long-form watch page (11.5.b), replacing
 * the mock, client-side accrual `use-watch-session.ts` used to run. The
 * client only reports what it played and asks whether a checkpoint is due;
 * the server decides coverage, timing and the eventual grant (5.1-5.3).
 *
 * Progress spans start at the last whole second REPORTED, not played,
 * because the server rounds each span inward — the same reasoning
 * `features/feed/use-quick-earn.ts` documents for the Quick-campaign loop
 * this mirrors. Kept as a separate file rather than a shared import: that
 * module is owned by a different area session (TASKS.md "Areas and
 * ownership"), and the two loops differ enough (checkpoints; no in-feed
 * chrome) that sharing code would mean editing their file anyway.
 */
export function useWatchEarnSession(campaignId: string) {
  const [phase, setPhase] = useState<WatchEarnPhase>({ kind: "idle" });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Session-lifetime facts, read from inside the polling interval and the
  // answer handler without forcing either to re-subscribe every render.
  const sessionIdRef = useRef<string | null>(null);
  const manifestUrlRef = useRef("");
  const durationRef = useRef(0);
  const totalQuestionsRef = useRef(0);
  const earningRef = useRef(true);
  const reportedTo = useRef(0);
  const questionsAsked = useRef(0);
  const checkpointBusy = useRef(false);
  const pendingReport = useRef<Promise<unknown> | null>(null);

  const start = useCallback(async () => {
    setPhase({ kind: "starting" });
    const started = await startWatchSessionAction(campaignId);
    if (!started.ok) {
      setPhase({ kind: "failed" });
      return;
    }
    const { session, manifestUrl, durationSeconds } = started.data;
    sessionIdRef.current = session.id;
    manifestUrlRef.current = manifestUrl;
    durationRef.current = durationSeconds;
    reportedTo.current = 0;
    questionsAsked.current = session.questionsAsked;
    const earning = !session.nonEarning;
    earningRef.current = earning;
    totalQuestionsRef.current = earning ? questionsAskedFor(durationSeconds) : 0;

    setPhase({
      kind: "watching",
      sessionId: session.id,
      manifestUrl,
      durationSeconds,
      totalQuestions: totalQuestionsRef.current,
      earning,
      coveredSeconds: 0,
    });
  }, [campaignId]);

  const backToWatching = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) return;
    setPhase({
      kind: "watching",
      sessionId,
      manifestUrl: manifestUrlRef.current,
      durationSeconds: durationRef.current,
      totalQuestions: totalQuestionsRef.current,
      earning: earningRef.current,
      coveredSeconds: reportedTo.current,
    });
  }, []);

  const tryPresentCheckpoint = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (
      sessionId === null ||
      checkpointBusy.current ||
      questionsAsked.current >= totalQuestionsRef.current
    ) {
      return;
    }
    checkpointBusy.current = true;
    const index = questionsAsked.current;
    void presentCheckpointAction(sessionId, index).then((result) => {
      checkpointBusy.current = false;
      if (!result.ok) {
        // 409 "not reached yet" is the ordinary case — just try again on
        // the next tick. Any other failure is left for the next tick too;
        // a checkpoint that never becomes presentable is a seeding gap
        // (checkpoint.controller.ts's own 404 case), not something a retry
        // loop should surface as fatal mid-video.
        return;
      }
      videoRef.current?.pause();
      setPhase({
        kind: "checkpoint",
        sessionId,
        checkpointIndex: index,
        totalQuestions: totalQuestionsRef.current,
        question: result.data.question,
        token: result.data.token,
        answerTimerMs: result.data.answerTimerMs,
      });
    });
  }, []);

  const report = useCallback((toSeconds: number) => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || !earningRef.current) return;
    const from = Math.floor(reportedTo.current);
    const to = Math.min(durationRef.current, toSeconds);
    if (to - from < 1) return;
    const pending = reportWatchProgressAction(sessionId, from, to);
    pendingReport.current = pending;
    void pending.then((result) => {
      if (result.ok && result.data.accepted) {
        reportedTo.current = to;
        setPhase((current) =>
          current.kind === "watching"
            ? { ...current, coveredSeconds: result.data.coveredSeconds }
            : current,
        );
      }
    });
  }, []);

  // Reports while playing and polls for the next checkpoint. Rate held at 1
  // and paused when hidden (EW-14) — same discipline as the in-feed loop.
  useEffect(() => {
    if (phase.kind !== "watching") return;
    const video = videoRef.current;
    if (!video) return;
    const timer = window.setInterval(() => {
      if (!video.paused && !video.ended) {
        report(video.currentTime);
        tryPresentCheckpoint();
      }
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
  }, [phase.kind, report, tryPresentCheckpoint]);

  const answer = useCallback(
    async (selectedOptionId: string | null) => {
      if (phase.kind !== "checkpoint") return;
      const { sessionId, checkpointIndex, token } = phase;
      const result = await answerCheckpointAction(
        sessionId,
        checkpointIndex,
        token,
        selectedOptionId,
      );
      if (result.ok) {
        questionsAsked.current = checkpointIndex + 1;
      }
      // Whether the answer succeeded or the token had already expired, the
      // honest move is to resume — a stuck overlay would be worse than a
      // missed question. When it did NOT succeed, `questionsAsked` has not
      // advanced, so the next tick's `tryPresentCheckpoint` re-asks for the
      // SAME index and gets a fresh token.
      backToWatching();
      videoRef.current?.play().then(
        () => undefined,
        () => undefined,
      );
    },
    [phase, backToWatching],
  );

  const finish = useCallback(async () => {
    if (sessionIdRef.current === null) return;
    await pendingReport.current;
    if (earningRef.current) {
      report(durationRef.current);
      await pendingReport.current;
    }
    setPhase({ kind: "claiming" });
    const completed = await completeWatchSessionAction(sessionIdRef.current);
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
        : { kind: "not_earning", reason: completed.data.reason ?? null },
    );
  }, [report]);

  return { phase, videoRef, start, answer, finish };
}

export type UseWatchEarnSession = ReturnType<typeof useWatchEarnSession>;

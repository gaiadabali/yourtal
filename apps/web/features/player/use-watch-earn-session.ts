"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import type { IdentityCheckStep } from "@yourtal/contracts/identity/earning-check";
import { questionsAskedFor } from "./question-schedule";
import { MIN_RESUMABLE_SECONDS } from "./resume-position";
import {
  answerCheckpointAction,
  completeWatchSessionAction,
  getWatchSessionAction,
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
      /** Why it is not earning, for the finish screen (`null` while earning). */
      nonEarningReason: string | null;
      /** Server-confirmed coverage (EW-15) — never the raw playhead. */
      coveredSeconds: number;
    }
  | {
      kind: "resume_prompt";
      sessionId: string;
      manifestUrl: string;
      durationSeconds: number;
      totalQuestions: number;
      earning: boolean;
      nonEarningReason: string | null;
      /** The first uncovered gap's start (server coverage, 11.5.b) — never a client-remembered playhead. */
      resumeAtSeconds: number;
    }
  | {
      kind: "checkpoint";
      sessionId: string;
      /** Kept through the question: the player's video must not lose its source (and with it the playhead) while paused. */
      manifestUrl: string;
      coveredSeconds: number;
      checkpointIndex: number;
      totalQuestions: number;
      question: PresentedQuestion;
      token: string;
      answerTimerMs: number;
    }
  /** D1 (1.6.l): the server refused the reward at start (budget or daily cap used up, paused, ...). Shown BEFORE any video plays; the viewer may still watch without earning. */
  | {
      kind: "refused";
      reason: string | null;
      /** F126: the identity-check steps still missing, when that is why. */
      identityCheck?: readonly IdentityCheckStep[];
    }
  | { kind: "claiming" }
  | { kind: "earned"; points: number; unlockAt: string | null }
  | {
      kind: "not_earning";
      reason: string | null;
      /** 5.9.f: the identity-check steps still missing, when that is why. */
      identityCheck?: readonly IdentityCheckStep[];
    }
  /** 12.2.e: a teen's own quiet hours (21:00-07:00) refused a NEW reward
   * session -- the long-form mirror of `use-quick-earn.ts`'s same phase.
   * Kind, not a generic failure, and never a retry loop. */
  | { kind: "quiet_hours" }
  /** `unwatchedSeconds` (5.13.af): the claim was refused because part of the video has not been watched, per the server's own gaps. */
  /** 5.13.af: why the claim was refused, when the server's own state says: seconds still unwatched, or questions still unanswered. */
  | { kind: "failed"; unwatchedSeconds?: number; questionsUnanswered?: true };

const REPORT_EVERY_MS = 4_000;
/** 5.13.ag: tries at the final span before claiming, one second apart. */
const FINAL_SEND_TRIES = 3;
/** 5.13.y: how long a resume or Start over may sit without the playhead moving before it is kicked once. */
const STALL_MS = 3_000;

interface Span {
  from: number;
  to: number;
}

/**
 * 5.13.af: what the browser actually played (`video.played`, which never
 * holds seeked-over, paused or stalled time) minus the spans already sent.
 * Reporting from this, rather than from the playhead, is what keeps a seek
 * from claiming the seconds it skipped and keeps the seconds played just
 * before it.
 */
export function unsentSpans(played: readonly Span[], sent: readonly Span[]): Span[] {
  const pieces: Span[] = [];
  // Earlier pieces count as sent: ranges kept from before a reload overlap the new ones.
  for (const range of played) pieces.push(...minus([range], [...sent, ...pieces]));
  return pieces;
}

/** `pieces` without any second inside `done`. */
function minus(pieces: readonly Span[], done: readonly Span[]): Span[] {
  let rest = [...pieces];
  for (const cut of done) {
    rest = rest.flatMap((piece) =>
      piece.to <= cut.from || piece.from >= cut.to
        ? [piece]
        : [
            ...(piece.from < cut.from ? [{ from: piece.from, to: cut.from }] : []),
            ...(piece.to > cut.to ? [{ from: cut.to, to: piece.to }] : []),
          ],
    );
  }
  return rest;
}

function rangesOf(played: TimeRanges): Span[] {
  return Array.from({ length: played.length }, (_, i) => ({
    from: played.start(i),
    to: played.end(i),
  }));
}

function playNow(video: HTMLVideoElement) {
  video.play().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Applies the resume prompt's choice to a video that may have loaded behind
 * it. WebKit could sit on a black frame at 0.1s after Start over (5.13.y):
 * a seek (even to where the playhead already was) and play() in the same
 * breath raced the stream's first load. So it seeks only when that moves the
 * playhead, and only once the stream's metadata is in, and plays once the
 * seek has landed. If after STALL_MS the playhead still sits at the target
 * with data to play, it calls play() once more, unless the viewer paused or
 * seeked meanwhile.
 */
function playFrom(video: HTMLVideoElement, seekTo: number): () => void {
  const play = () => playNow(video);
  const off: (() => void)[] = [];
  const on = (type: string, listener: () => void, once = false) => {
    video.addEventListener(type, listener, { once });
    off.push(() => video.removeEventListener(type, listener));
  };
  const atTarget = () => Math.abs(video.currentTime - seekTo) <= 0.5;

  let ownSeek = false;
  let viewerActed = false;
  const go = () => {
    if (atTarget()) return play();
    ownSeek = true;
    on("seeked", play, true);
    video.currentTime = seekTo;
  };
  // No stream yet (hls.js attaches after this runs): a seek now fires no `seeked`, and a browser may drop it.
  if (video.readyState < 1 && !atTarget()) on("loadedmetadata", go, true);
  else go();

  on("seeking", () => {
    if (ownSeek) ownSeek = false;
    else viewerActed = true;
  });
  on("pause", () => {
    viewerActed = true;
  });
  const timer = window.setTimeout(() => {
    const stuck =
      !viewerActed && !video.ended && !video.seeking && atTarget() && video.readyState >= 3;
    if (stuck) play();
  }, STALL_MS);
  return () => {
    window.clearTimeout(timer);
    for (const remove of off) remove();
  };
}

/** An answer that ends a span: accepted, or refused for the report itself (4xx). Auth (401), timeout (408), rate limit (429), a server failure or no answer at all keep it to retry. */
function closesSpan(result: Awaited<ReturnType<typeof reportWatchProgressAction>>): boolean {
  if (result.ok) return true;
  const { error } = result;
  return (
    error.kind === "http" &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}

/**
 * The real reward session for the long-form watch page (11.5.b), replacing
 * the mock, client-side accrual `use-watch-session.ts` used to run. The
 * client only reports what it played and asks whether a checkpoint is due;
 * the server decides coverage, timing and the eventual grant (5.1-5.3).
 *
 * Progress spans are what `video.played` holds beyond the spans already
 * sent (`unsentSpans`), each started at its whole second, because the server
 * rounds each span inward — the same reasoning
 * `features/feed/use-quick-earn.ts` documents for the Quick-campaign loop
 * this mirrors. Kept as a separate file rather than a shared import: that
 * module is owned by a different area session (TASKS.md "Areas and
 * ownership"), and the two loops differ enough (checkpoints; no in-feed
 * chrome) that sharing code would mean editing their file anyway.
 */
export function useWatchEarnSession(campaignId: string) {
  const [phase, setPhase] = useState<WatchEarnPhase>({ kind: "idle" });
  /** V7: the last question ran out of time. Cleared when a session starts again. */
  const [questionTimedOut, setQuestionTimedOut] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Session-lifetime facts, read from inside the polling interval and the
  // answer handler without forcing either to re-subscribe every render.
  const sessionIdRef = useRef<string | null>(null);
  const manifestUrlRef = useRef("");
  const durationRef = useRef(0);
  const totalQuestionsRef = useRef(0);
  const earningRef = useRef(true);
  const nonEarningReasonRef = useRef<string | null>(null);
  const identityCheckRef = useRef<readonly IdentityCheckStep[] | undefined>(undefined);
  const coveredRef = useRef(0);
  /** 5.13.af: spans sent, in flight or answered; a retryable failure takes its span back out. */
  const sentRef = useRef<Span[]>([]);
  /** 5.13.ag: spans the server refused, never claimed again until really re-played (see `releaseReplayed`). */
  const refusedRef = useRef<Span[]>([]);
  /** 5.13.ag: where the current unbroken run of playback began (a seek, a reload or a refusal starts a new one), and the playhead last seen in it. */
  const runRef = useRef({ from: 0, to: 0 });
  /** 5.13.ag: `video.played` from before a reload (the playback-error Retry), which empties it. */
  const playedBeforeRef = useRef<Span[]>([]);
  /** 5.13.ag: set by `keepPlayed` until the reload empties the element; the old stream's last `timeupdate`s are not the new run's. */
  const reloadingRef = useRef(false);
  const pendingReports = useRef(new Set<Promise<unknown>>());
  const questionsAsked = useRef(0);
  const checkpointBusy = useRef(false);
  /** Set only when the viewer chose "resume" — applied once the video element (re-)mounts into the "watching" phase. */
  const pendingSeekRef = useRef<number | null>(null);
  /** 5.13.u: where an earlier attempt stopped. Server coverage already passes any question it left unanswered, so asking before the playhead is back here would show it at once. */
  const askFromRef = useRef(0);

  /** Resume prompt or straight into playback, from the server's recorded coverage. */
  const beginPlayback = useCallback(
    async (sessionId: string, manifestUrl: string, durationSeconds: number, earning: boolean) => {
      // A resumed session (this is not the viewer's first visit) may already
      // have real server coverage. `detail.ok === false` degrades to "start
      // fresh" — a resume prompt is a nicety, never a blocker.
      const detail = await getWatchSessionAction(sessionId);
      const coveredSoFar = detail.ok ? detail.data.coveredSeconds : 0;
      sentRef.current = [];
      refusedRef.current = [];
      playedBeforeRef.current = [];
      runRef.current = { from: 0, to: 0 };
      coveredRef.current = coveredSoFar;
      const firstGap = detail.ok ? detail.data.gaps[0] : undefined;
      askFromRef.current = firstGap?.fromSecond ?? 0;

      if (coveredSoFar >= MIN_RESUMABLE_SECONDS && firstGap !== undefined) {
        setPhase({
          kind: "resume_prompt",
          sessionId,
          manifestUrl,
          durationSeconds,
          totalQuestions: totalQuestionsRef.current,
          earning,
          nonEarningReason: nonEarningReasonRef.current,
          resumeAtSeconds: firstGap.fromSecond,
        });
        return;
      }

      setPhase({
        kind: "watching",
        sessionId,
        manifestUrl,
        durationSeconds,
        totalQuestions: totalQuestionsRef.current,
        earning,
        nonEarningReason: nonEarningReasonRef.current,
        coveredSeconds: coveredSoFar,
      });
    },
    [],
  );

  const start = useCallback(async () => {
    setPhase({ kind: "starting" });
    const started = await startWatchSessionAction(campaignId);
    if (!started.ok) {
      setPhase(
        started.error.kind === "http" && started.error.code === "teen_quiet_hours"
          ? { kind: "quiet_hours" }
          : { kind: "failed" },
      );
      return;
    }
    const { session, manifestUrl, durationSeconds, identityCheck } = started.data;
    sessionIdRef.current = session.id;
    manifestUrlRef.current = manifestUrl;
    durationRef.current = durationSeconds;
    questionsAsked.current = session.questionsAsked;
    const earning = !session.nonEarning;
    earningRef.current = earning;
    nonEarningReasonRef.current = session.nonEarningReason;
    identityCheckRef.current = identityCheck?.missing;
    setQuestionTimedOut(false);
    totalQuestionsRef.current = earning ? questionsAskedFor(durationSeconds) : 0;

    // A repeat visit (already earned) just plays; any other refusal is told to
    // the viewer first, and playback waits for their choice.
    if (!earning && session.nonEarningReason !== "already_earned") {
      setPhase({
        kind: "refused",
        reason: session.nonEarningReason,
        ...(identityCheck === undefined ? {} : { identityCheck: identityCheck.missing }),
      });
      return;
    }
    await beginPlayback(session.id, manifestUrl, durationSeconds, earning);
  }, [campaignId, beginPlayback]);

  /** The refusal notice's "watch without earning" choice. */
  const watchWithoutEarning = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) return;
    setPhase({ kind: "starting" });
    await beginPlayback(sessionId, manifestUrlRef.current, durationRef.current, false);
  }, [beginPlayback]);

  /** The resume prompt's own choice — never auto-resumes (resume-prompt.tsx's own rule). */
  const chooseResume = useCallback(
    (choice: "resume" | "restart") => {
      if (phase.kind !== "resume_prompt") return;
      pendingSeekRef.current = choice === "resume" ? phase.resumeAtSeconds : 0;
      setPhase({
        kind: "watching",
        sessionId: phase.sessionId,
        manifestUrl: phase.manifestUrl,
        durationSeconds: phase.durationSeconds,
        totalQuestions: phase.totalQuestions,
        earning: phase.earning,
        nonEarningReason: phase.nonEarningReason,
        coveredSeconds: coveredRef.current,
      });
    },
    [phase],
  );

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
      nonEarningReason: nonEarningReasonRef.current,
      coveredSeconds: coveredRef.current,
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
        manifestUrl: manifestUrlRef.current,
        coveredSeconds: coveredRef.current,
        checkpointIndex: index,
        totalQuestions: totalQuestionsRef.current,
        question: result.data.question,
        token: result.data.token,
        answerTimerMs: result.data.answerTimerMs,
      });
    });
  }, []);

  /** Refused seconds played again in the current run are claimable again; a run is unbroken playback, so they really were re-played. */
  const releaseReplayed = useCallback((playhead: number) => {
    const run = { from: runRef.current.from, to: Math.max(runRef.current.from, playhead) };
    refusedRef.current = minus(refusedRef.current, [run]);
  }, []);

  /** Ends the current run at its last playhead and starts the next one at `at`. */
  const newRun = useCallback(
    (at: number) => {
      releaseReplayed(runRef.current.to);
      runRef.current = { from: at, to: at };
    },
    [releaseReplayed],
  );

  /** Sends every played span not sent yet, and returns them. `atEnd`: the video ended, so a span within 1s of the end is the end (the playhead stops just short of it). */
  const reportPlayed = useCallback(
    (atEnd = false): Span[] => {
      const sessionId = sessionIdRef.current;
      const video = videoRef.current;
      if (sessionId === null || !earningRef.current || !video) return [];
      const duration = durationRef.current;
      const mediaEnd = Number.isFinite(video.duration)
        ? Math.min(video.duration, duration)
        : duration;
      // Mid-seek the playhead is already the target, not a played position.
      if (!video.seeking) releaseReplayed(video.currentTime);
      const sent: Span[] = [];
      for (const piece of unsentSpans(
        [...playedBeforeRef.current, ...rangesOf(video.played)],
        [...sentRef.current, ...refusedRef.current],
      )) {
        const from = Math.floor(piece.from);
        const to = Math.min(duration, atEnd && piece.to >= mediaEnd - 1 ? duration : piece.to);
        if (to - from < 1) continue;
        const span = { from, to };
        sent.push(span);
        sentRef.current = [...sentRef.current, span];
        const retryLater = () => {
          sentRef.current = sentRef.current.filter((s) => s !== span);
        };
        const pending = reportWatchProgressAction(sessionId, from, to).then((result) => {
          const accepted = result.ok && result.data.accepted;
          if (!accepted) retryLater();
          // A refused span is not claimed again (re-sending it wedged every
          // later report, 5.13.ac) until its seconds are played again after
          // the refusal (5.13.ag); until then they stay a server gap.
          if (!accepted && closesSpan(result)) {
            newRun(video.currentTime);
            refusedRef.current = [...refusedRef.current, span];
          }
          if (result.ok && result.data.accepted) {
            coveredRef.current = result.data.coveredSeconds;
            setPhase((current) =>
              current.kind === "watching"
                ? { ...current, coveredSeconds: result.data.coveredSeconds }
                : current,
            );
          }
        }, retryLater);
        pendingReports.current.add(pending);
        void pending.finally(() => pendingReports.current.delete(pending));
      }
      return sent;
    },
    [releaseReplayed, newRun],
  );

  // Reports while playing and polls for the next checkpoint. Rate held at 1
  // and paused when hidden (EW-14) — same discipline as the in-feed loop.
  useEffect(() => {
    if (phase.kind !== "watching") return;
    const video = videoRef.current;
    if (!video) return;
    const timer = window.setInterval(() => {
      if (!video.paused && !video.ended) {
        reportPlayed();
        if (video.currentTime >= askFromRef.current) tryPresentCheckpoint();
      }
    }, REPORT_EVERY_MS);
    const holdRate = () => {
      if (video.playbackRate !== 1) video.playbackRate = 1;
    };
    const onSeeking = () => newRun(video.currentTime);
    const onTimeUpdate = () => {
      if (!video.seeking && !reloadingRef.current) runRef.current.to = video.currentTime;
    };
    const onReloaded = () => {
      reloadingRef.current = false;
    };
    const onHidden = () => {
      if (document.hidden) video.pause();
    };
    video.addEventListener("ratechange", holdRate);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("emptied", onReloaded);
    video.addEventListener("loadstart", onReloaded);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("ratechange", holdRate);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("emptied", onReloaded);
      video.removeEventListener("loadstart", onReloaded);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [phase.kind, reportPlayed, tryPresentCheckpoint, newRun]);

  // Applies the resume prompt's choice once the video element mounts with
  // this session's manifest — setting `currentTime` before that would have
  // no element to set it on. Runs once per resume/restart choice, never on
  // an ordinary fresh start (pendingSeekRef stays null then).
  // The source loaded behind the prompt, so `autoPlay` turning on now starts
  // nothing by itself.
  useEffect(() => {
    if (phase.kind !== "watching") return;
    const seekTo = pendingSeekRef.current;
    if (seekTo === null) return;
    pendingSeekRef.current = null;
    const video = videoRef.current;
    if (!video) return;
    return playFrom(video, seekTo);
  }, [phase.kind]);

  /** Call before the playback-error Retry reloads the stream: a reload empties `video.played`, and what it held may not all be sent yet (5.13.ag). */
  const keepPlayed = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // Stops the old stream growing `played` past what is kept here.
    video.pause();
    playedBeforeRef.current = [...playedBeforeRef.current, ...rangesOf(video.played)];
    // The reloaded stream starts again at 0, with no seek.
    newRun(0);
    reloadingRef.current = true;
  }, [newRun]);

  const answer = useCallback(
    async (selectedOptionId: string | null, timedOut = false, answeredBool?: boolean) => {
      if (phase.kind !== "checkpoint") return;
      const { sessionId, checkpointIndex, token } = phase;
      const result = await answerCheckpointAction(
        sessionId,
        checkpointIndex,
        token,
        selectedOptionId,
        ...(answeredBool === undefined ? [] : [answeredBool]),
      );
      if (result.ok) {
        questionsAsked.current = checkpointIndex + 1;
        // V7: a question that ran out of time is said so; the server
        // recorded it as unanswered.
        if (timedOut) setQuestionTimedOut(true);
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
    // A view that was never going to earn (already earned, refused) has
    // nothing to claim, and the player reports no coverage for it, so the
    // server would refuse the claim and the viewer would read "this video
    // failed to start" (V12). Say why it did not earn instead.
    if (!earningRef.current) {
      setPhase({
        kind: "not_earning",
        reason: nonEarningReasonRef.current,
        ...(identityCheckRef.current === undefined
          ? {}
          : { identityCheck: identityCheckRef.current }),
      });
      return;
    }
    await Promise.all(pendingReports.current);
    // 5.13.ag: a final span that hit a server error is sent again, a few times, before claiming.
    for (let tries = 1; ; tries += 1) {
      const sent = reportPlayed(true);
      await Promise.all(pendingReports.current);
      const retry = sent.some(
        (span) => !sentRef.current.includes(span) && !refusedRef.current.includes(span),
      );
      if (!retry || tries === FINAL_SEND_TRIES) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    setPhase({ kind: "claiming" });
    const completed = await completeWatchSessionAction(sessionIdRef.current);
    if (!completed.ok) {
      // 5.13.af: a claim refused (403) for skipped seconds or unanswered
      // questions says which, from the server's own state, not "couldn't start".
      const detail =
        completed.error.kind === "http" && completed.error.status === 403
          ? await getWatchSessionAction(sessionIdRef.current)
          : null;
      if (detail?.ok !== true) {
        setPhase({ kind: "failed" });
        return;
      }
      const unwatchedSeconds = detail.data.gaps.reduce(
        (sum, gap) => sum + gap.toSecond - gap.fromSecond,
        0,
      );
      setPhase(
        unwatchedSeconds > 0
          ? { kind: "failed", unwatchedSeconds }
          : // The server's own count when the detail carries it (5.13.ag4), else the client's schedule.
            (detail.data.questionsAnswered ?? detail.data.session.questionsAsked) <
              (detail.data.questionsExpected ?? totalQuestionsRef.current)
            ? { kind: "failed", questionsUnanswered: true }
            : { kind: "failed" },
      );
      return;
    }
    const missing = completed.data.missing ?? identityCheckRef.current;
    setPhase(
      completed.data.granted
        ? {
            kind: "earned",
            points: completed.data.pendingPoints,
            unlockAt: completed.data.unlockAt ?? null,
          }
        : {
            kind: "not_earning",
            reason: completed.data.reason ?? null,
            ...(missing === undefined ? {} : { identityCheck: missing }),
          },
    );
  }, [reportPlayed]);

  return {
    phase,
    questionTimedOut,
    videoRef,
    start,
    watchWithoutEarning,
    chooseResume,
    answer,
    finish,
    keepPlayed,
  };
}

export type UseWatchEarnSession = ReturnType<typeof useWatchEarnSession>;

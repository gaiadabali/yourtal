"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/terms";
import { AccrualIndicator } from "./accrual-indicator";
import { CheckpointOverlay } from "./checkpoint-overlay";
import { EarnMoment, NotEarningMoment } from "./earn-moment";
import { PlayIcon } from "./player-icons";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";
import { useWatchEarnSession } from "./use-watch-earn-session";

// Loaded on intent only, never server-rendered — see hls-attacher.tsx's own
// doc comment. The session's manifest URL does not exist until `start()`
// resolves, so this can only ever mount after a real user tap anyway.
const HlsAttacher = dynamic(() => import("./hls-attacher").then((mod) => mod.HlsAttacher), {
  ssr: false,
});

const HLS_HEIGHT = 720;

export interface VideoPlayerProps {
  campaign: Campaign;
  terms: CampaignTerms;
  /** No default (6.1.c) — every child's copy and point formatting depends on this. */
  locale: SupportedLocale;
}

/**
 * The long-form watch page's player (11.5.b), wired to the real server
 * session (`use-watch-earn-session.ts`) instead of the mock, client-side
 * accrual this component used to run — see that hook's own header for why.
 *
 * Deliberately smaller than the machinery it replaces: native `<video
 * controls>` for play/pause/seek, no chapters, quality tiers or resume
 * offer. Those are `open-view-player.tsx`'s territory (a different, still-
 * live flow this file does not touch) and 11.5's own "polish only if time
 * remains" — the founder's ask for this pass is the reward loop itself:
 * real playback, a real paused question, a real earn moment.
 */
export function VideoPlayer({ campaign, terms, locale }: VideoPlayerProps) {
  const t = getPlayerTranslator(locale);
  const { phase, videoRef, start, answer, finish } = useWatchEarnSession(campaign.id);
  const [nativeHls, setNativeHls] = useState<boolean | null>(null);
  const maxPoints = terms.rewardPoints + terms.accuracyBonusPoints;

  // Probed on a detached element, before the session's own <video> mounts
  // (the bug this exact check fixed for the in-feed player, 2fc73a9c).
  useEffect(() => {
    setNativeHls(
      document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "",
    );
  }, []);

  const isWatching = phase.kind === "watching" || phase.kind === "checkpoint";
  const showStartOverlay =
    phase.kind === "idle" || phase.kind === "starting" || phase.kind === "failed";
  const manifestUrl = phase.kind === "watching" ? phase.manifestUrl : null;
  const coveredSeconds = phase.kind === "watching" ? phase.coveredSeconds : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-fg">
        <video
          ref={videoRef}
          className="h-full w-full"
          playsInline
          autoPlay={isWatching}
          controls={isWatching}
          poster={campaign.posterUrl}
          aria-label={campaign.title}
          src={manifestUrl !== null && nativeHls === true ? manifestUrl : undefined}
          onEnded={() => void finish()}
        />
        {manifestUrl !== null && nativeHls === false ? (
          <HlsAttacher videoRef={videoRef} src={manifestUrl} desiredHeight={HLS_HEIGHT} />
        ) : null}

        {showStartOverlay ? (
          // eslint-disable-next-line yt-b/prefer-primitives -- a full-bleed absolute hit target over the video itself, not a styled control (see video-player's prior version of this same element).
          <button
            type="button"
            onClick={() => void start()}
            disabled={phase.kind === "starting"}
            aria-label={t("controls.playCampaign", { title: campaign.title })}
            className="absolute inset-0 flex items-center justify-center bg-fg/40 text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          >
            <PlayIcon className="h-14 w-14" />
          </button>
        ) : null}

        {phase.kind === "checkpoint" ? (
          <CheckpointOverlay
            key={phase.question.id}
            question={phase.question}
            questionNumber={phase.checkpointIndex + 1}
            totalQuestions={phase.totalQuestions}
            answerTimerMs={phase.answerTimerMs}
            onAnswer={(selectedOptionId) => void answer(selectedOptionId)}
            locale={locale}
          />
        ) : null}
      </div>

      {phase.kind === "failed" ? (
        <p role="alert" className="text-sm font-sans text-danger">
          {t("errors.startFailed")}
        </p>
      ) : null}

      {phase.kind === "watching" && phase.earning ? (
        <AccrualIndicator
          accruedPoints={
            phase.durationSeconds > 0 ? (coveredSeconds / phase.durationSeconds) * maxPoints : 0
          }
          totalPoints={maxPoints}
          // Not tracked precisely here (no native-control play/pause state
          // wiring in this simplified player) — always "playing" so the
          // pending-reward copy shows rather than the background-paused
          // one, which would be actively wrong most of the time.
          isPlaying
          isBackgrounded={false}
          locale={locale}
        />
      ) : null}

      {phase.kind === "claiming" ? (
        <p role="status" className="text-sm font-sans text-fg-muted">
          {t("earn.claiming")}
        </p>
      ) : null}
      {phase.kind === "earned" ? (
        <EarnMoment points={phase.points} unlockAt={phase.unlockAt} locale={locale} />
      ) : null}
      {phase.kind === "not_earning" ? (
        <NotEarningMoment reason={phase.reason} locale={locale} />
      ) : null}
    </div>
  );
}

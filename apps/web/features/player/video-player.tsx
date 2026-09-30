"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/terms";
import type { PublicListing } from "@yourtal/contracts/listing";
import { Button } from "@yourtal/ui/button";
import { AccrualIndicator } from "./accrual-indicator";
import { ChapterTrack } from "./chapter-track";
import { CheckpointOverlay } from "./checkpoint-overlay";
import { EarnMoment, NotEarningMoment } from "./earn-moment";
import { playerChapters } from "./player-chapters";
import { PlayIcon } from "./player-icons";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";
import { SpendAtBrand } from "./spend-at-brand";
import { UpNextCard } from "./up-next-card";
import { useWatchEarnSession } from "./use-watch-earn-session";
// 12.2.e: the same hook the in-feed reward loop uses (12.2.b) -- reused
// here rather than duplicated, since the counting logic (foreground-only,
// one nudge, never a repeat) is identical for both players. `features/feed`
// owns the file; this is a plain cross-feature import, the same pattern
// `features/feed/quick-earn.tsx` already uses for `features/player`.
import { useWatchTimeReminder } from "@/features/feed/use-watch-time-reminder";

// Loaded on intent only, never server-rendered — see hls-attacher.tsx's own
// doc comment. The session's manifest URL does not exist until `start()`
// resolves, so this can only ever mount after a real user tap anyway.
const HlsAttacher = dynamic(() => import("./hls-attacher").then((mod) => mod.HlsAttacher), {
  ssr: false,
});
const ResumePrompt = dynamic(() => import("./resume-prompt").then((mod) => mod.ResumePrompt), {
  ssr: false,
});

const HLS_HEIGHT = 720;

export interface VideoPlayerProps {
  campaign: Campaign;
  terms: CampaignTerms;
  /** No default (6.1.c) — every child's copy and point formatting depends on this. */
  locale: SupportedLocale;
  /** 11.5.c: the completion screen's Up Next — one other still-live campaign from this channel, or `null` when there is none. Never autoplayed. */
  upNext?: Campaign | null;
  /** 11.5.c: the funder's own store listings, "Spend at <brand>" on the completion screen. */
  vouchers?: readonly PublicListing[];
  /** 12.2.e: gates the teen-only watch-time reminder below. Defaults to `false` -- widens what already rendered, never narrows it, same convention as `feed-data.ts`'s own `ageBand` fallback. */
  isTeen?: boolean;
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
export function VideoPlayer({
  campaign,
  terms,
  locale,
  upNext = null,
  vouchers = [],
  isTeen = false,
}: VideoPlayerProps) {
  const t = getPlayerTranslator(locale);
  const { phase, videoRef, start, chooseResume, answer, finish } = useWatchEarnSession(campaign.id);
  const [nativeHls, setNativeHls] = useState<boolean | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [videoError, setVideoError] = useState(false);
  // 12.2.e: a gentle, non-blocking nudge after ~45 continuous foreground
  // minutes -- teen-only, same threshold and "one nudge, never a nag" rule
  // as the feed's own (12.2.b). Never pauses or alters playback.
  const watchTimeReminder = useWatchTimeReminder(isTeen);
  const maxPoints = terms.rewardPoints + terms.accuracyBonusPoints;
  const chapters = playerChapters(campaign);

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
  // Chapters are a progress/navigation device, never an accrual one (O-1) —
  // "reached" comes from server-confirmed coverage, same figure
  // AccrualIndicator already uses, never the raw playhead.
  const reachedChapterIndex = chapters.reduce(
    (reached, chapter, index) => (coveredSeconds >= chapter.startSeconds ? index : reached),
    -1,
  );

  return (
    <div className="flex flex-col gap-4">
      {watchTimeReminder.show ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3"
        >
          <p className="text-sm font-sans text-fg-muted">{t("watchTimeReminder.body")}</p>
          <Button type="button" size="sm" variant="secondary" onClick={watchTimeReminder.dismiss}>
            {t("watchTimeReminder.dismiss")}
          </Button>
        </div>
      ) : null}
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
          onTimeUpdate={(event) => setCurrentSeconds(event.currentTarget.currentTime)}
          onError={() => setVideoError(true)}
        >
          {campaign.captionsUrl !== null ? (
            <track kind="captions" src={campaign.captionsUrl} label={t("controls.captions")} />
          ) : null}
        </video>
        {manifestUrl !== null && nativeHls === false ? (
          <HlsAttacher videoRef={videoRef} src={manifestUrl} desiredHeight={HLS_HEIGHT} />
        ) : null}

        {/* 12.4.d/#9: every long-form campaign is funded by a business, so
            every player says so, plainly, in text -- never a colour alone.
            Always shown, not tied to any phase; a real (non-decorative)
            label, so it stays in the accessibility tree, not hidden from it. */}
        <span className="pointer-events-none absolute top-2 left-2 z-10 rounded-control bg-overlay px-1.5 py-0.5 text-caption font-sans font-medium text-white">
          {t("sponsoredLabel")}
        </span>

        {phase.kind === "resume_prompt" ? (
          <ResumePrompt
            positionSeconds={phase.resumeAtSeconds}
            onChoose={chooseResume}
            locale={locale}
          />
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

        {videoError && isWatching ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-fg/70 p-4 text-center text-primary-fg">
            <p role="alert" className="text-sm font-sans">
              {t("errors.playbackFailed")}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setVideoError(false);
                videoRef.current?.load();
                videoRef.current?.play().then(
                  () => undefined,
                  () => undefined,
                );
              }}
            >
              {t("errors.retry")}
            </Button>
          </div>
        ) : null}
      </div>

      {phase.kind === "failed" ? (
        <p role="alert" className="text-sm font-sans text-danger">
          {t("errors.startFailed")}
        </p>
      ) : null}

      {/* 12.2.e: a kind explanation, not a retry button -- trying again does
          not help until quiet hours end (the long-form mirror of the feed's
          own `quiet_hours` phase, 12.2.b). `showStartOverlay` already
          excludes this phase, so no play button sits over it either. */}
      {phase.kind === "quiet_hours" ? (
        <p role="status" className="text-sm font-sans text-fg-muted">
          {t("quietHours.message")}
        </p>
      ) : null}

      {chapters.length > 0 && isWatching ? (
        <ChapterTrack
          chapters={chapters}
          reachedChapterIndex={reachedChapterIndex}
          currentSeconds={currentSeconds}
          onSelectChapter={(startSeconds) => {
            const video = videoRef.current;
            if (video) video.currentTime = startSeconds;
          }}
          locale={locale}
        />
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

      {/* 11.5.c: the completion screen only — Up Next and the funder's own
          vouchers never show before the video is actually finished, and
          Up Next is a tap-through link, never an autoplaying continuation. */}
      {phase.kind === "earned" || phase.kind === "not_earning" ? (
        <>
          {upNext !== null ? <UpNextCard campaign={upNext} locale={locale} /> : null}
          <SpendAtBrand merchantName={campaign.merchantName} listings={vouchers} locale={locale} />
        </>
      ) : null}
    </div>
  );
}

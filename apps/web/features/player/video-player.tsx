"use client";

import dynamic from "next/dynamic";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { PlayerChapter } from "./player-chapters";
import { getQualityTier } from "./quality-tier";
import { useTabVisibility } from "./use-tab-visibility";
import { useWatchSession } from "./use-watch-session";
import { AccrualIndicator } from "./accrual-indicator";
import { ChapterTrack } from "./chapter-track";
import { CompletionHandoff } from "./completion-handoff";
import { PlayerControls } from "./player-controls";
import { PlayIcon } from "./player-icons";
// Lazy: the resume prompt only renders when a prior position exists, and it
// pulls in Radix Dialog. Keeping it out of the initial chunk is what holds
// this route inside the 170 KB initial-JS gate (docs/13b section 8).
const ResumePrompt = dynamic(() => import("./resume-prompt").then((mod) => mod.ResumePrompt), {
  ssr: false,
});
import { SeekSlider } from "./seek-slider";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

// Loaded on intent only (mounted after the user taps play, see below), and
// never server-rendered — see hls-attacher.tsx's own doc comment for why
// this is what keeps hls.js out of this route's initial JS.
const HlsAttacher = dynamic(() => import("./hls-attacher").then((mod) => mod.HlsAttacher), {
  ssr: false,
});

export interface VideoPlayerProps {
  campaign: Campaign;
  chapters: readonly PlayerChapter[];
  /** No default (6.1.c) — every child's copy and point formatting depends on this. */
  locale: SupportedLocale;
}

export function VideoPlayer({ campaign, chapters, locale }: VideoPlayerProps) {
  const t = getPlayerTranslator(locale);
  const isVisible = useTabVisibility();
  const session = useWatchSession(campaign, chapters, !isVisible);
  const showStartOverlay = !session.hasStarted && !session.resumeOffer;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-fg">
        {/*
          No native `controls` — every control is the custom set below, so
          this element is hidden from assistive tech to avoid two competing
          (and, for the native controls, keyboard-inconsistent) surfaces.
          No captions/track exist yet either: that is an encode-time gap
          (docs/06 §6 ingest pipeline), not something this ticket produces.
        */}
        <video ref={session.videoRef} className="h-full w-full" playsInline aria-hidden="true" />
        {showStartOverlay ? (
          // A native element, not @yourtal/ui/button: this is a full-bleed
          // `absolute inset-0` hit target over the video itself, not a
          // styled button — the primitive's own padding/sizing would fight
          // that layout for no accessibility gain (it is already a real
          // <button> with an aria-label).
          // eslint-disable-next-line yt-b/prefer-primitives
          <button
            type="button"
            onClick={session.handlePlay}
            aria-label={t("controls.playCampaign", { title: campaign.title })}
            className="absolute inset-0 flex items-center justify-center bg-fg/40 text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlayIcon className="h-14 w-14" />
          </button>
        ) : null}
        {session.hasStarted && !session.useNativeHls ? (
          <HlsAttacher
            videoRef={session.videoRef}
            src={session.manifestUrl}
            desiredHeight={getQualityTier(session.qualityTierId).resolutionHeight}
          />
        ) : null}
      </div>

      {session.resumeOffer ? (
        <ResumePrompt
          positionSeconds={session.resumeOffer.positionSeconds}
          onChoose={session.dismissResumeOffer}
          locale={locale}
        />
      ) : null}

      <AccrualIndicator
        accruedPoints={session.accruedPoints}
        totalPoints={campaign.rewardPoints}
        isPlaying={session.isPlaying}
        isBackgrounded={session.isBackgrounded}
        locale={locale}
      />

      <SeekSlider
        currentSeconds={session.virtualCurrentTime}
        durationSeconds={campaign.durationSeconds}
        chapters={chapters}
        onSeek={session.handleSeekTo}
        locale={locale}
      />

      <ChapterTrack
        chapters={chapters}
        reachedChapterIndex={session.reachedChapterIndex}
        currentSeconds={session.virtualCurrentTime}
        onSelectChapter={session.handleSeekTo}
        locale={locale}
      />

      <PlayerControls
        isPlaying={session.isPlaying}
        currentSeconds={session.virtualCurrentTime}
        durationSeconds={campaign.durationSeconds}
        onPlay={session.handlePlay}
        onPause={session.handlePause}
        qualityTierId={session.qualityTierId}
        onSelectQuality={session.setQualityTierId}
        locale={locale}
      />

      {session.hasEnded ? (
        <CompletionHandoff
          campaignId={campaign.id}
          provisionalPoints={session.accruedPoints}
          locale={locale}
        />
      ) : null}

      {/* Play/pause state, announced once per transition — not spammed per frame. */}
      <p role="status" aria-live="polite" className="sr-only">
        {session.isPlaying ? t("status.playing") : session.hasStarted ? t("status.paused") : ""}
      </p>
    </div>
  );
}

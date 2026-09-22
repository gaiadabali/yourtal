"use client";

import dynamic from "next/dynamic";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { PlayerChapter } from "@/features/player/player-chapters";
import { getQualityTier } from "@/features/player/quality-tier";
import { useWatchSession } from "@/features/player/use-watch-session";
import { PlayerControls } from "@/features/player/player-controls";
import { PlayIcon } from "@/features/player/player-icons";
import { SeekSlider } from "@/features/player/seek-slider";
import { buildOpenViewSignupHref } from "./open-view-signup-href";
import { OpenViewChapterTrack } from "./open-view-chapter-track";
import { OpenViewForegoneRewardBanner } from "./open-view-foregone-reward-banner";
import { OpenViewSignupPrompt } from "./open-view-signup-prompt";
import type { OpenViewCopy } from "./open-view-copy";

// Same lazy-loading discipline as features/player/video-player.tsx, for the
// same 170 KB initial-JS reason (docs/13b-typescript-standards.md section 8).
const ResumePrompt = dynamic(
  () => import("@/features/player/resume-prompt").then((mod) => mod.ResumePrompt),
  { ssr: false },
);
const HlsAttacher = dynamic(
  () => import("@/features/player/hls-attacher").then((mod) => mod.HlsAttacher),
  { ssr: false },
);

export interface OpenViewPlayerProps {
  campaign: Campaign;
  chapters: readonly PlayerChapter[];
  copy: OpenViewCopy;
}

/**
 * Anonymous full playback (YT-0432). Deliberately its own composition
 * rather than a mode flag on `features/player/video-player.tsx` (YT-0412):
 * every rewarded-only piece there — `AccrualIndicator`,
 * `CompletionHandoff`'s checkpoint hand-off, `chapter-track.tsx`'s
 * per-chapter point values — has no honest anonymous equivalent, so
 * threading an `isOpenView` prop through that file would leave the door
 * open to a reward number rendering for a signed-out viewer by accident
 * (a config bug, not a design one, but the wrong kind of bug to be
 * possible here at all). A second component that shares every reward-free
 * primitive (`SeekSlider`, `PlayerControls`, `useWatchSession` and, through
 * it, `resume-position.ts`) but never imports the reward-bearing ones is
 * the safer boundary.
 *
 * `useWatchSession`'s `isBackgrounded` parameter only ever feeds
 * `AccrualIndicator`'s "paused" copy inside `use-watch-session.ts` itself —
 * nothing else in the hook reads it — and this component renders no
 * `AccrualIndicator`, so `false` is passed literally rather than pulling in
 * `useTabVisibility` for a value nothing here would use.
 */
export function OpenViewPlayer({ campaign, chapters, copy }: OpenViewPlayerProps) {
  const session = useWatchSession(campaign, chapters, false);
  const showStartOverlay = !session.hasStarted && !session.resumeOffer;
  const signupHref = buildOpenViewSignupHref(campaign.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-fg">
        {/* No native `controls`, matching video-player.tsx: every control is
            the custom set below. No claim affordance exists anywhere in this
            tree — the only actions this component ever renders are play,
            pause, seek, quality, and the two sign-up links, never a reward
            claim of any kind (YT-0432's first acceptance criterion). */}
        <video ref={session.videoRef} className="h-full w-full" playsInline aria-hidden="true" />
        {showStartOverlay ? (
          <button
            type="button"
            onClick={session.handlePlay}
            aria-label={`Play ${campaign.title}`}
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
        />
      ) : null}

      <OpenViewForegoneRewardBanner
        eyebrow={copy.eyebrow}
        notice={copy.foregoneRewardNotice}
        signupHref={signupHref}
        signupLinkLabel={copy.signupLinkLabel}
      />

      <SeekSlider
        currentSeconds={session.virtualCurrentTime}
        durationSeconds={campaign.durationSeconds}
        chapters={chapters}
        onSeek={session.handleSeekTo}
      />

      <OpenViewChapterTrack
        chapters={chapters}
        reachedChapterIndex={session.reachedChapterIndex}
        currentSeconds={session.virtualCurrentTime}
        onSelectChapter={session.handleSeekTo}
        watchedLabel={copy.chapterWatchedStatus}
        watchingLabel={copy.chapterWatchingStatus}
        upcomingLabel={copy.chapterUpcomingStatus}
      />

      <PlayerControls
        isPlaying={session.isPlaying}
        currentSeconds={session.virtualCurrentTime}
        durationSeconds={campaign.durationSeconds}
        onPlay={session.handlePlay}
        onPause={session.handlePause}
        qualityTierId={session.qualityTierId}
        onSelectQuality={session.setQualityTierId}
      />

      {session.hasEnded ? (
        <OpenViewSignupPrompt
          heading={copy.finishedHeading}
          body={copy.finishedBody}
          signupHref={signupHref}
          signupCta={copy.signupCta}
        />
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {session.isPlaying ? "Playing" : session.hasStarted ? "Paused" : ""}
      </p>
    </div>
  );
}

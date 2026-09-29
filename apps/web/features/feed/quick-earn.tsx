"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { PointsChip } from "@yourtal/ui/points-chip";
import { HlsAttacher } from "@/features/player/hls-attacher";
import { formatFeedPoints, type FeedLocale } from "./feed-terms";
import type { useQuickEarn } from "./use-quick-earn";

type QuickEarnState = ReturnType<typeof useQuickEarn>;

const HLS_HEIGHT = 540;

export interface QuickEarnVideoProps {
  earn: QuickEarnState;
  title: string;
  /** The feed item is on screen; swiping away pauses the session. */
  active: boolean;
}

/** The reward session's own player, replacing the teaser while it runs (11.4.b). */
export function QuickEarnVideo({ earn, title, active }: QuickEarnVideoProps) {
  const t = useTranslations("feed");
  const { phase, finish, videoRef } = earn;
  const [nativeHls, setNativeHls] = useState<boolean | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) setNativeHls(video.canPlayType("application/vnd.apple.mpegurl") !== "");
  }, [videoRef]);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active, videoRef]);

  if (phase.kind !== "watching") return null;
  return (
    <div className="absolute inset-0 z-10 bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        autoPlay
        aria-label={title}
        src={nativeHls === true ? phase.manifestUrl : undefined}
        onEnded={() => void finish()}
      />
      {nativeHls === false ? (
        <HlsAttacher videoRef={videoRef} src={phase.manifestUrl} desiredHeight={HLS_HEIGHT} />
      ) : null}
      <p className="absolute inset-x-3 top-3 rounded-control bg-overlay px-3 py-1.5 text-center text-caption font-sans text-white">
        {t("earn.watching")}
      </p>
    </div>
  );
}

export interface QuickEarnActionProps {
  earn: QuickEarnState;
  rewardPoints: number;
  locale: FeedLocale;
}

/** Earn button, then the earn moment: "+N pts earned, pending, unlocks <date>". */
export function QuickEarnAction({ earn, rewardPoints, locale }: QuickEarnActionProps) {
  const t = useTranslations("feed");
  const format = useFormatter();
  const { phase, start } = earn;

  if (phase.kind === "earned") {
    return (
      <div role="status" className="flex flex-col items-start gap-1">
        <PointsChip
          value={phase.points}
          prefix="+"
          size="lg"
          locale={locale}
          aria-label={t("earn.earned", { points: formatFeedPoints(locale, phase.points) })}
        />
        {phase.unlockAt ? (
          <span className="text-caption font-sans text-white">
            {t("earn.unlocks", {
              date: format.dateTime(new Date(phase.unlockAt), { dateStyle: "medium" }),
            })}
          </span>
        ) : null}
      </div>
    );
  }

  if (phase.kind === "not_earning") {
    return (
      <p role="status" className="text-body-sm font-sans text-white">
        {phase.alreadyEarned ? t("earn.alreadyEarned") : t("earn.notEarning")}
      </p>
    );
  }

  if (phase.kind === "watching") return null;

  const busy = phase.kind === "starting" || phase.kind === "claiming";
  const label =
    phase.kind === "starting"
      ? t("earn.starting")
      : phase.kind === "claiming"
        ? t("earn.claiming")
        : phase.kind === "failed"
          ? t("earn.retry")
          : t("item.earn", { points: formatFeedPoints(locale, rewardPoints) });
  return (
    <div className="flex flex-col items-start gap-1">
      {phase.kind === "failed" ? (
        <span role="alert" className="text-caption font-sans text-white">
          {t("earn.failed")}
        </span>
      ) : null}
      <Button size="lg" onClick={() => void start()} disabled={busy} aria-busy={busy}>
        {label}
      </Button>
    </div>
  );
}

"use client";

import { Button } from "@yourtal/ui/button";
import { formatClock } from "./format-clock";
import { PauseIcon, PlayIcon } from "./player-icons";
import dynamic from "next/dynamic";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

// Lazy: the quality selector is a Radix Sheet that only opens on tap. It has
// no business in the initial chunk (docs/13b section 8, 170 KB gate).
const QualitySelector = dynamic(
  () => import("./quality-selector").then((mod) => mod.QualitySelector),
  {
    ssr: false,
  },
);
import type { QualityTierId } from "./quality-tier";

export interface PlayerControlsProps {
  isPlaying: boolean;
  currentSeconds: number;
  durationSeconds: number;
  onPlay: () => void;
  onPause: () => void;
  qualityTierId: QualityTierId;
  onSelectQuality: (id: QualityTierId) => void;
  locale: SupportedLocale;
}

export function PlayerControls({
  isPlaying,
  currentSeconds,
  durationSeconds,
  onPlay,
  onPause,
  qualityTierId,
  onSelectQuality,
  locale,
}: PlayerControlsProps) {
  const t = getPlayerTranslator(locale);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          aria-label={isPlaying ? t("controls.pause") : t("controls.play")}
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
        </Button>
        <span className="text-sm font-sans text-fg-muted" aria-hidden="true">
          {formatClock(currentSeconds)} / {formatClock(durationSeconds)}
        </span>
      </div>
      <QualitySelector
        durationSeconds={durationSeconds}
        selectedTierId={qualityTierId}
        onSelect={onSelectQuality}
        locale={locale}
      />
    </div>
  );
}

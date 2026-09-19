"use client";

import { Button } from "@yourtal/ui/button";
import { formatClock } from "./format-clock";
import { PauseIcon, PlayIcon } from "./player-icons";
import dynamic from "next/dynamic";

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
}

export function PlayerControls({
  isPlaying,
  currentSeconds,
  durationSeconds,
  onPlay,
  onPause,
  qualityTierId,
  onSelectQuality,
}: PlayerControlsProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          aria-label={isPlaying ? "Pause" : "Play"}
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
      />
    </div>
  );
}

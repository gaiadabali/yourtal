"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@yourtal/ui/button";
import type { CampaignVideoUpload } from "./campaign-draft";

export interface CampaignEditorUploadProps {
  video: CampaignVideoUpload;
  onChange: (video: CampaignVideoUpload) => void;
  disabled?: boolean;
}

const PROGRESS_TICK_MS = 200;
const PROGRESS_STEP_PERCENT = 8;
const PROCESSING_DELAY_MS = 800;

/**
 * Upload with progress (docs/tasks/phase-u-ui.md YT-0441). Phase U is
 * mock-only (no real upload endpoint exists), so choosing a file starts a
 * simulated progress climb — idle -> uploading -> processing -> ready —
 * rather than actually transferring bytes anywhere. The interval is
 * cleaned up on unmount and whenever a new file is chosen mid-upload, so
 * switching files never leaves a stray timer bumping a percentage no
 * longer on screen.
 */
export function CampaignEditorUpload({ video, onChange, disabled }: CampaignEditorUploadProps) {
  const inputId = useId();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const progressRef = useRef(0);

  function handleFileChosen(fileName: string) {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    progressRef.current = 0;
    onChange({ fileName, status: "uploading", progressPercent: 0 });

    intervalRef.current = setInterval(() => {
      progressRef.current = Math.min(100, progressRef.current + PROGRESS_STEP_PERCENT);
      if (progressRef.current >= 100) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        onChange({ fileName, status: "processing", progressPercent: 100 });
        setTimeout(
          () => onChange({ fileName, status: "ready", progressPercent: 100 }),
          PROCESSING_DELAY_MS,
        );
        return;
      }
      onChange({ fileName, status: "uploading", progressPercent: progressRef.current });
    }, PROGRESS_TICK_MS);
  }

  const statusLabel: Record<CampaignVideoUpload["status"], string> = {
    idle: "No video uploaded yet",
    uploading: `Uploading… ${video.progressPercent}%`,
    processing: "Processing (encoding, moderation scan)…",
    ready: "Ready",
    failed: "Upload failed — try again",
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-sans font-medium text-fg">
        Video file
      </label>
      <input
        id={inputId}
        type="file"
        accept="video/*"
        disabled={disabled || video.status === "uploading" || video.status === "processing"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFileChosen(file.name);
          }
        }}
        className="text-sm font-sans text-fg file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-sans file:text-fg"
      />
      <p className="text-xs font-sans text-fg-muted">{statusLabel[video.status]}</p>
      {video.status === "uploading" || video.status === "processing" ? (
        // Native <progress>, not `@yourtal/ui/progress` (`@radix-ui/react-progress`)
        // — that primitive alone cost ~5 KB gz measured in this route's own
        // production chunk (see this ticket's report), and a native element
        // already has an implicit `progressbar` role and accessible value
        // with no JavaScript at all.
        <progress
          value={video.status === "processing" ? 100 : video.progressPercent}
          max={100}
          aria-label="Video upload progress"
          className="h-2 w-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-raised [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
        />
      ) : null}
      {video.status === "failed" ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange({ fileName: null, status: "idle", progressPercent: 0 })}
        >
          Reset
        </Button>
      ) : null}
    </div>
  );
}

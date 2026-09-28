"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import type { CampaignVideoUpload } from "./campaign-draft";
import { uploadCampaignVideo } from "./media-upload-client";

export interface CampaignEditorUploadProps {
  video: CampaignVideoUpload;
  onChange: (video: CampaignVideoUpload) => void;
  disabled?: boolean;
  businessId: string;
  campaignId: string;
  teaserStartSeconds: number;
  /** `YOURTAL_DATA_SOURCE === "live"`, resolved server-side and threaded down (mock-source's own switch reads `process.env`, which is server-only — a client component cannot resolve it itself). */
  isLiveMode: boolean;
}

const MOCK_PROGRESS_TICK_MS = 200;
const MOCK_PROGRESS_STEP_PERCENT = 8;
const MOCK_PROCESSING_DELAY_MS = 800;

/**
 * Upload with progress (task 7.8.b). Live: a real presigned multipart
 * upload against 7.2's media pipeline (`media-upload-client.ts`) — every
 * byte goes browser-to-object-store directly, this component only orchestrates
 * it. Mock: the original `setInterval` simulation, kept as-is (no real
 * upload endpoint to fake against in mock mode, and Phase 6/7's own local
 * dev defaults to mock).
 */
export function CampaignEditorUpload({
  video,
  onChange,
  disabled,
  businessId,
  campaignId,
  teaserStartSeconds,
  isLiveMode,
}: CampaignEditorUploadProps) {
  const t = useTranslations("studio");
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

  function handleFileChosenMock(fileName: string) {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    progressRef.current = 0;
    onChange({ fileName, status: "uploading", progressPercent: 0 });

    intervalRef.current = setInterval(() => {
      progressRef.current = Math.min(100, progressRef.current + MOCK_PROGRESS_STEP_PERCENT);
      if (progressRef.current >= 100) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        onChange({ fileName, status: "processing", progressPercent: 100 });
        setTimeout(
          () => onChange({ fileName, status: "ready", progressPercent: 100 }),
          MOCK_PROCESSING_DELAY_MS,
        );
        return;
      }
      onChange({ fileName, status: "uploading", progressPercent: progressRef.current });
    }, MOCK_PROGRESS_TICK_MS);
  }

  function handleFileChosen(file: File) {
    if (!isLiveMode) {
      handleFileChosenMock(file.name);
      return;
    }
    void uploadCampaignVideo({
      file,
      businessId,
      campaignId,
      teaserStartSeconds,
      onUpdate: onChange,
    });
  }

  const statusLabel: Record<CampaignVideoUpload["status"], string> = {
    idle: t("campaignBuilder.upload.statusIdle"),
    uploading: t("campaignBuilder.upload.statusUploading", { percent: video.progressPercent }),
    processing: t("campaignBuilder.upload.statusProcessing"),
    ready: t("campaignBuilder.upload.statusReady"),
    failed: video.failureReason
      ? t("campaignBuilder.upload.statusFailedWithReason", { reason: video.failureReason })
      : t("campaignBuilder.upload.statusFailed"),
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-sans font-medium text-fg">
        {t("campaignBuilder.upload.videoFileLabel")}
      </label>
      <input
        id={inputId}
        type="file"
        accept="video/*"
        disabled={disabled || video.status === "uploading" || video.status === "processing"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFileChosen(file);
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
          aria-label={t("campaignBuilder.upload.progressAriaLabel")}
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
          {t("campaignBuilder.upload.reset")}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { uploadSidecarCaptionsAction } from "./media-upload-actions";

/** Restated from the contract's limit so this client module stays zod-free. */
const MAX_CAPTIONS_BYTES = 512 * 1024;

/**
 * 13.9.c: a business's own captions file (.vtt) beside the video. Used when
 * the video carries no subtitle stream; an embedded track always wins.
 */
export function CampaignEditorCaptions({
  businessId,
  assetId,
  disabled,
}: {
  businessId: string;
  assetId: string;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations("studio");
  const inputId = useId();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setMessage(null);
    if (file.size > MAX_CAPTIONS_BYTES) {
      setMessage({ tone: "error", text: t("campaignBuilder.captions.tooLarge") });
      return;
    }
    startTransition(async () => {
      const result = await uploadSidecarCaptionsAction(businessId, assetId, await file.text());
      setMessage(
        result.ok
          ? { tone: "ok", text: t("campaignBuilder.captions.saved", { name: file.name }) }
          : { tone: "error", text: t("campaignBuilder.captions.invalid") },
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-sans font-medium text-fg">
        {t("campaignBuilder.captions.label")}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".vtt,text/vtt"
        disabled={disabled === true || pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
        className="text-sm font-sans text-fg file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-sans file:text-fg"
      />
      <p className="text-xs font-sans text-fg-muted">{t("campaignBuilder.captions.help")}</p>
      {message === null ? null : (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={
            message.tone === "error"
              ? "text-xs font-sans text-danger-solid"
              : "text-xs font-sans text-fg-muted"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

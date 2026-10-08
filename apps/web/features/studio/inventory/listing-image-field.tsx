"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  LISTING_IMAGE_CONTENT_TYPES,
  LISTING_IMAGE_MAX_BYTES,
} from "@yourtal/contracts/listing/image-values";
import { createListingImageUploadUrlAction } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";

type Failure = "unsupported" | "tooLarge" | "failed";

export interface ListingImageFieldProps {
  businessId: string;
  /** The uploaded picture's public address, or `""` while none is chosen. */
  imageUrl: string;
  onChange: (imageUrl: string) => void;
  /** The form's own "add a picture" message, shown when it is submitted without one. */
  errorMessage?: string;
  disabled: boolean;
}

const MAX_MB = LISTING_IMAGE_MAX_BYTES / (1024 * 1024);
const ACCEPT = LISTING_IMAGE_CONTENT_TYPES.join(",");

/**
 * The reward card's picture, uploaded rather than linked: the browser asks the platform for a
 * presigned address, sends the file straight to object storage, and the form keeps only the
 * public address that results. Images only, and refused above the size limit before any upload.
 */
export function ListingImageField(props: ListingImageFieldProps) {
  const t = useTranslations("studio");
  const inputId = useId();
  const messageId = useId();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function choose(file: File) {
    setFailure(null);
    const code = classify(file);
    if (code !== null) {
      setFailure(t(`inventory.form.image.${code}`, { maxMb: MAX_MB }));
      return;
    }
    setUploading(true);
    try {
      const minted = await createListingImageUploadUrlAction(props.businessId, file.type);
      if (!minted.ok) {
        setFailure(t(`inventory.error.${inventoryErrorKey(minted.code)}`));
        return;
      }
      const put = await fetch(minted.value.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) {
        setFailure(t("inventory.form.image.failed"));
        return;
      }
      setPreview(URL.createObjectURL(file));
      props.onChange(minted.value.imageUrl);
    } catch {
      setFailure(t("inventory.form.image.failed"));
    } finally {
      setUploading(false);
    }
  }

  const message =
    failure ??
    (props.errorMessage !== undefined && props.imageUrl === "" ? props.errorMessage : null);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label font-sans text-fg">
        {t("inventory.form.imageLabel")}
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        disabled={props.disabled || uploading}
        aria-describedby={messageId}
        aria-invalid={message === null ? undefined : true}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
        className="text-body-sm font-sans text-fg file:mr-3 file:rounded-control file:border file:border-border file:bg-surface-raised file:px-3 file:py-1.5 file:text-body-sm file:font-sans file:text-fg"
      />
      <p id={messageId} className="text-caption font-sans text-fg-muted">
        {t("inventory.form.imageHelp", { maxMb: MAX_MB })}
      </p>
      {uploading ? (
        <p role="status" className="text-body-sm font-sans text-fg-muted">
          {t("inventory.form.image.uploading")}
        </p>
      ) : props.imageUrl !== "" && failure === null ? (
        <div role="status" className="flex items-center gap-3">
          {preview === null ? null : (
            <img src={preview} alt="" className="h-16 w-16 rounded-control object-cover" />
          )}
          <span className="text-body-sm font-sans text-fg">{t("inventory.form.image.ready")}</span>
        </div>
      ) : null}
      {message === null ? null : (
        <p role="alert" className="text-body-sm font-sans text-danger-solid">
          {message}
        </p>
      )}
    </div>
  );
}

function classify(file: File): Failure | null {
  if (!(LISTING_IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) return "unsupported";
  if (file.size > LISTING_IMAGE_MAX_BYTES) return "tooLarge";
  return null;
}

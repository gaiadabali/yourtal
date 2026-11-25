"use client";

import { useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { KybDocumentType } from "@yourtal/contracts/business/kyb-document";
import { Button } from "@yourtal/ui/button";
import { canUploadKyb, type KybRow } from "./kyb-status";
import { createKybUploadUrlAction, submitKybDocumentAction } from "./submit-kyb-action";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
/** Under nginx's 16 MB cap on a presigned PUT. */
const MAX_BYTES = 10 * 1024 * 1024;

type Failure = "unsupportedType" | "tooLarge" | "uploadFailed";

/** 13.3.b: presigned PUT from the browser, then the API records the document for ops review. */
async function sendDocument(businessId: string, documentType: KybDocumentType, file: File) {
  const minted = await createKybUploadUrlAction(businessId, file.type);
  if (!minted.ok) throw new Error(minted.message);
  const put = await fetch(minted.data.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error(String(put.status));
  const saved = await submitKybDocumentAction(businessId, documentType, minted.data.storageRef);
  if (!saved.ok) throw new Error(saved.message);
}

/** Every required document with its status; each can be uploaded (or replaced while pending) on its own. */
export function KybDocumentList({ businessId, rows }: { businessId: string; rows: KybRow[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <KybDocumentRowItem key={row.type} businessId={businessId} row={row} />
      ))}
    </ul>
  );
}

function KybDocumentRowItem({ businessId, row }: { businessId: string; row: KybRow }) {
  const t = useTranslations("studio");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const typeLabel = t(`chrome.verification.documentType.${row.type}`);
  const buttonKey = row.status === "submitted" ? "replace" : "upload";

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("document");
    if (!(file instanceof File) || file.size === 0) return;
    if (!ACCEPTED.includes(file.type)) return setFailure("unsupportedType");
    if (file.size > MAX_BYTES) return setFailure("tooLarge");
    setBusy(true);
    setFailure(null);
    try {
      await sendDocument(businessId, row.type, file);
      router.refresh();
    } catch {
      setFailure("uploadFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col">
        <span className="text-label font-sans text-fg">{typeLabel}</span>
        <span className="text-body-sm text-fg-muted" data-status={row.status}>
          {t(`chrome.verification.status.${row.status}`)}
        </span>
      </div>
      {canUploadKyb(row.status) ? (
        <form
          aria-label={typeLabel}
          onSubmit={(event) => void upload(event)}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <input
            type="file"
            name="document"
            required
            aria-label={t("chrome.verification.fileFor", { type: typeLabel })}
            accept={ACCEPTED.join(",")}
            className="text-body-sm text-fg"
          />
          <Button type="submit" className="w-fit" disabled={busy}>
            {busy ? t("chrome.verification.uploading") : t(`chrome.verification.${buttonKey}`)}
          </Button>
          {failure ? (
            <p className="text-body-sm text-danger-solid" role="alert">
              {t(`chrome.verification.error.${failure}`)}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

"use client";

import { useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { NativeSelect } from "@yourtal/ui/native-select";
import { createKybUploadUrlAction, submitKybDocumentAction } from "./submit-kyb-action";

const KYB_DOCUMENT_TYPES = [
  "business_registration_certificate",
  "tax_registration_number",
  "director_identity",
  "proof_of_address",
] as const;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
/** Under nginx's 16 MB cap on a presigned PUT. */
const MAX_BYTES = 10 * 1024 * 1024;

type Failure = "unsupportedType" | "tooLarge" | "uploadFailed";

/** 13.3.b: presigned PUT from the browser, then the API records the document for ops review. */
export function KybUploadForm({ businessId }: { businessId: string }) {
  const t = useTranslations("studio");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("document");
    const rawType = form.get("documentType");
    const documentType = typeof rawType === "string" ? rawType : "";
    if (!(file instanceof File) || file.size === 0) return;
    if (!ACCEPTED.includes(file.type)) return setFailure("unsupportedType");
    if (file.size > MAX_BYTES) return setFailure("tooLarge");
    setBusy(true);
    setFailure(null);
    try {
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
      router.refresh();
    } catch {
      setFailure("uploadFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void upload(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <NativeSelect
        name="documentType"
        label={t("chrome.verification.documentTypeLabel")}
        required
        defaultValue={KYB_DOCUMENT_TYPES[0]}
        className="sm:max-w-xs"
      >
        {KYB_DOCUMENT_TYPES.map((value) => (
          <option key={value} value={value}>
            {t(`chrome.verification.documentType.${value}`)}
          </option>
        ))}
      </NativeSelect>
      <label className="flex flex-col gap-1.5">
        <span className="text-label font-sans text-fg">{t("chrome.verification.fileLabel")}</span>
        <input
          type="file"
          name="document"
          required
          accept={ACCEPTED.join(",")}
          className="text-body-sm text-fg"
        />
      </label>
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? t("chrome.verification.uploading") : t("chrome.verification.submit")}
      </Button>
      {failure ? (
        <p className="text-body-sm text-danger-solid" role="alert">
          {t(`chrome.verification.error.${failure}`)}
        </p>
      ) : null}
    </form>
  );
}

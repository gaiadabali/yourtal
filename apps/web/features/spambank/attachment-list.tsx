"use client";

import { Download, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Attachment } from "@yourtal/mail-engine";
import { Heading } from "@yourtal/ui/heading";
import { fileSize } from "./mail-format";
import type { MailLocale } from "./mail-format";

/** Saves a downloaded part without ever letting the browser open it as a page. */
export function saveBlob(blob: Blob, name: string): void {
  const safe = new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(safe);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The attachments of a message, each a download button. Inline parts are not listed. */
export function AttachmentList({
  items,
  locale,
  onDownload,
  busy,
}: {
  items: Attachment[];
  locale: MailLocale;
  onDownload: (a: Attachment) => void;
  busy: string | null;
}) {
  const t = useTranslations("spambank.reader");
  const shown = items.filter((a) => !a.inline);
  if (shown.length === 0) return null;
  return (
    <section aria-label={t("attachmentsLabel")} className="mt-5 border-t border-border-subtle pt-4">
      <Heading level={3} size="title" className="mb-2 text-body-sm">
        {t("attachmentsCount", { count: shown.length })}
      </Heading>
      <ul className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <li key={a.blobId}>
            <button
              type="button"
              onClick={() => onDownload(a)}
              disabled={busy === a.blobId}
              className="flex max-w-full items-center gap-2 rounded-control border border-border-control px-3 py-2 text-left text-caption font-sans hover:border-border-strong disabled:opacity-60"
              aria-label={t("download", { name: a.name, size: fileSize(a.size, locale) })}
            >
              <Paperclip aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 truncate font-medium text-fg">{a.name}</span>
              <span className="shrink-0 tabular-nums text-fg-muted">
                {fileSize(a.size, locale)}
              </span>
              <Download aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

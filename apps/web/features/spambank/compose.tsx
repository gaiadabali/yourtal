"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Draft } from "@yourtal/mail-engine";
import { useMailClient, useMessage } from "@yourtal/mail-engine/react";
import { ComposeForm } from "./compose-form";
import { fullDate } from "./mail-format";
import { folderHref } from "./mail-routes";
import type { ComposeMode } from "./mail-routes";
import { useMailBase } from "./mail-root";
import { prettifyQuotedDates } from "./mail-text";
import { ErrorBlock, ListSkeleton, useMailErrorText, useMailLocale } from "./mail-ui";

/** Loads the message a reply, forward or draft starts from, then hands a draft to the form. */
export function Compose({ mode, id }: { mode: ComposeMode; id: string | null }) {
  const t = useTranslations("spambank");
  const client = useMailClient();
  const base = useMailBase();
  const locale = useMailLocale();
  const errorText = useMailErrorText();
  const { message, loading, error } = useMessage(mode === "new" ? null : id);

  const initial = useMemo<Draft | null>(() => {
    if (mode === "new") return { to: [], subject: "", text: "" };
    if (!message) return null;
    if (mode === "draft") {
      const draft: Draft = {
        draftId: message.id,
        to: message.to,
        subject: message.subject,
        text: message.text ?? "",
      };
      if (message.cc.length > 0) draft.cc = message.cc;
      const kept = message.attachments.filter((a) => !a.inline);
      if (kept.length > 0) draft.attachments = kept;
      const parent = message.references[message.references.length - 1];
      if (parent) {
        draft.references = message.references;
        draft.inReplyTo = parent;
      }
      return draft;
    }
    const draft = client.draftFrom(message, mode);
    return { ...draft, text: prettifyQuotedDates(draft.text, (iso) => fullDate(iso, locale)) };
  }, [client, mode, message, locale]);

  if (initial) return <ComposeForm key={`${mode}-${id ?? "new"}`} mode={mode} initial={initial} />;
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Link
          href={folderHref(base, "inbox")}
          className="inline-flex text-caption font-sans font-semibold text-accent hover:underline"
        >
          {t("compose.backToInbox")}
        </Link>
        <ErrorBlock
          message={error.code === "rejected" ? t("compose.parentGone") : errorText(error)}
        />
      </div>
    );
  }
  return loading || !message ? <ListSkeleton rows={4} /> : null;
}

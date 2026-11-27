"use client";

import { useTranslations } from "next-intl";
import type { MessageDetail, UnsubscribeResult } from "@yourtal/mail-engine";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { senderLabel } from "./mail-format";

export type UnsubState =
  | { step: "idle" }
  | { step: "working" }
  | { step: "done"; result: Extract<UnsubscribeResult, { status: "done" }>; moved: boolean }
  | { step: "link"; url: string }
  | { step: "failed"; unavailable: boolean };

/** Only a plain https link is offered as a way out; the server has already vetted it. */
function httpsOnly(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** One-tap unsubscribe for a mailing list (BUILD.md section 4.5). The words and buttons, no fetching. */
export function UnsubscribeBar({
  message,
  state,
  moveToJunk,
  onToggleMove,
  onUnsubscribe,
}: {
  message: MessageDetail;
  state: UnsubState;
  moveToJunk: boolean;
  onToggleMove: (next: boolean) => void;
  onUnsubscribe: () => void;
}) {
  const t = useTranslations("spambank.unsubscribe");
  const tl = useTranslations("spambank.list");
  const who = senderLabel(message.from, tl("unknownSender"));
  const canMove = message.folder !== "junk" && message.folder !== "spam";

  if (state.step === "done") {
    return (
      <Notice tone="success" title={t("doneTitle")} data-testid="unsubscribe-done">
        {t("doneBody", { who })}
        {state.moved ? ` ${t("movedToJunk")}` : ""}
      </Notice>
    );
  }
  if (state.step === "link") {
    const href = httpsOnly(state.url);
    return (
      <Notice tone="warning">
        {t("needsWebsite", { who })}{" "}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline"
          >
            {t("openPage")}
          </a>
        ) : (
          t("linkUnsafe")
        )}
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Text size="body-sm">{t("prompt", { who })}</Text>
        {canMove ? (
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-caption font-sans text-fg-muted">
            <input
              type="checkbox"
              checked={moveToJunk}
              onChange={(e) => onToggleMove(e.target.checked)}
              className="size-4 accent-accent"
            />
            {t("alsoMove")}
          </label>
        ) : null}
        {state.step === "failed" ? (
          <Text size="caption" tone="danger" role="alert" className="mt-1">
            {state.unavailable ? t("unavailable") : t("failed")}
          </Text>
        ) : null}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onUnsubscribe}
        disabled={state.step === "working"}
        className="shrink-0 self-start sm:self-center"
      >
        {state.step === "working" ? t("working") : t("cta")}
      </Button>
    </div>
  );
}

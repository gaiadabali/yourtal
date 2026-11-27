"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { MailErrorCode } from "@yourtal/mail-engine";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";
import { Notice } from "@yourtal/ui/notice";
import { Skeleton } from "@yourtal/ui/skeleton";
import { mailLocale } from "./mail-format";
import type { MailLocale } from "./mail-format";

/** The person's display locale, narrowed to the two the catalogues cover. */
export function useMailLocale(): MailLocale {
  return mailLocale(useLocale());
}

/**
 * The engine's `MailError`, recognised by name: this file is on Me too, which must not pull the
 * engine into its first load (`mail-client.ts` is the only door to it).
 */
function mailErrorOf(error: unknown): { code: MailErrorCode; message: string } | null {
  if (!(error instanceof Error) || error.name !== "MailError") return null;
  const code = (error as Error & { code?: MailErrorCode }).code;
  return code === undefined ? null : { code, message: error.message };
}

/** Plain words for an engine error. Never a stack, a status code or a server's own wording. */
export function useMailErrorText(): (error: unknown) => string {
  const t = useTranslations("spambank.errors");
  return (raw) => {
    const error = mailErrorOf(raw);
    if (!error) return t("generic");
    switch (error.code) {
      case "unauthorized":
        return t("unauthorized");
      case "not_enabled":
        return t("notEnabled");
      case "unavailable":
        return t("unavailable");
      case "rate_limited":
        return t("rateLimited");
      case "network":
        return t("network");
      case "too_many_recipients":
        return t("tooManyRecipients");
      case "daily_send_cap":
        return t("dailySendCap");
      case "rejected":
        // The engine words its own pre-send checks; a server message is cut short and kept plain.
        return error.message && error.message !== "rejected"
          ? error.message.slice(0, 160)
          : t("rejected");
    }
  };
}

type NoticeTone = "neutral" | "error";

/** A short status line under the toolbar: what just happened, or what went wrong. */
export function MailNotice({
  tone = "neutral",
  children,
  onDismiss,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const t = useTranslations("spambank.common");
  return (
    <Notice
      tone={tone === "error" ? "danger" : "info"}
      action={
        onDismiss ? (
          <Button type="button" variant="link" size="sm" onClick={onDismiss}>
            {t("dismiss")}
          </Button>
        ) : undefined
      }
    >
      {children}
    </Notice>
  );
}

let flash: string | null = null;

/**
 * A message to show on the NEXT screen: "Moved to Spam." belongs on the list the person lands on
 * after the reader closes, not on the reader that is about to unmount.
 */
export function flashNotice(text: string): void {
  flash = text;
}

function takeFlash(): { tone: NoticeTone; text: string } | null {
  const text = flash;
  flash = null;
  return text === null ? null : { tone: "neutral", text };
}

/** Notice state that clears itself after a few seconds (errors stay until dismissed). */
export function useNotice(): {
  notice: { tone: NoticeTone; text: string } | null;
  say: (text: string) => void;
  fail: (text: string) => void;
  clear: () => void;
} {
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(takeFlash);
  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    notice,
    say: (text) => setNotice({ tone: "neutral", text }),
    fail: (text) => setNotice({ tone: "error", text }),
    clear: () => setNotice(null),
  };
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-border-subtle border-b border-border-subtle">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-4">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-12" />
        </li>
      ))}
    </ul>
  );
}

/** A failed read with a way out, never a blank panel. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations("spambank.common");
  return (
    <ErrorState
      title={t("errorTitle")}
      description={message}
      retry={
        onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        ) : undefined
      }
    />
  );
}

/** True when the page is in dark mode: the explicit theme first, the system setting second. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const explicit = document.documentElement.getAttribute("data-theme");
      setDark(explicit === "dark" || (explicit !== "light" && media.matches));
    };
    read();
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);
  return dark;
}

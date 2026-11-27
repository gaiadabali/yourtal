"use client";

import Link from "next/link";
import type { Route } from "next";
import { Paperclip, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MessageSummary } from "@yourtal/mail-engine";
import { Button } from "@yourtal/ui/button";
import { cn } from "@yourtal/ui/cn";
import { listDate, senderLabel } from "./mail-format";
import type { MailLocale } from "./mail-format";

/**
 * One line of a message list. The checkbox and the star are real controls beside the link, never
 * inside it, so a click on either never opens the message. In Sent and Drafts the "who" is the
 * recipients, not the sender (who is always you).
 */
export function MessageRow({
  message,
  href,
  locale,
  selected,
  onSelect,
  onFlag,
  showFolder = false,
  now,
}: {
  message: MessageSummary;
  href: Route;
  locale: MailLocale;
  selected: boolean;
  onSelect: (next: boolean) => void;
  onFlag: (next: boolean) => void;
  /** Search results span folders, so they say which one each hit is in. */
  showFolder?: boolean;
  now?: Date;
}) {
  const t = useTranslations("spambank");
  const outgoing = message.folder === "sent" || message.folder === "drafts";
  const unknown = t("list.unknownSender");
  const first = message.to[0];
  const recipients =
    message.to.length === 0
      ? t("list.noRecipients")
      : message.to.length === 1
        ? senderLabel(first, unknown)
        : t("list.andMore", { name: senderLabel(first, unknown), count: message.to.length - 1 });
  const who = outgoing ? t("list.toPrefix", { recipients }) : senderLabel(message.from, unknown);
  const subject = message.subject.trim() || t("list.noSubject");
  return (
    <li
      data-testid="mail-row"
      data-unread={message.unread ? "true" : "false"}
      className={cn(
        "group relative flex items-stretch transition-colors",
        selected ? "bg-accent-subtle" : "hover:bg-surface-sunken",
      )}
    >
      <div className="flex items-center gap-0.5 pl-1.5 sm:pl-3">
        <label className="grid size-9 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={t("list.selectMessage", { who, subject })}
            className="size-4 accent-accent-text"
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onFlag(!message.flagged)}
          aria-pressed={message.flagged}
          aria-label={message.flagged ? t("list.unstar") : t("list.star")}
          className={cn("size-9", message.flagged ? "text-warning-solid" : "text-fg-subtle")}
        >
          <Star
            aria-hidden="true"
            className="size-[17px]"
            fill={message.flagged ? "currentColor" : "none"}
          />
        </Button>
      </div>
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-3 sm:pr-4">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            message.unread ? "bg-accent-text" : "bg-transparent",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
          <span
            className={cn(
              "truncate text-body-sm font-sans sm:w-48 sm:shrink-0",
              message.unread ? "font-semibold text-fg" : "font-medium text-fg-muted",
            )}
          >
            {who}
            {message.unread ? <span className="sr-only"> {t("list.unreadSr")}</span> : null}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-body-sm font-sans">
            <span
              className={cn(
                "min-w-0 truncate sm:max-w-[60%] sm:shrink-0",
                message.unread ? "font-semibold text-fg" : "text-fg",
              )}
            >
              {subject}
            </span>
            {message.preview ? (
              <span className="hidden truncate text-fg-muted sm:inline">
                <span aria-hidden="true">{"– "}</span>
                {message.preview}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 self-start pt-0.5 text-caption font-sans text-fg-muted sm:self-center sm:pt-0">
          {showFolder && message.folder ? (
            <span className="hidden rounded-control bg-surface-sunken px-1.5 py-0.5 sm:inline">
              {t(`folders.${message.folder}`)}
            </span>
          ) : null}
          {message.hasAttachment ? (
            <span>
              <Paperclip aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("list.hasAttachments")}</span>
            </span>
          ) : null}
          <time dateTime={message.receivedAt} className="whitespace-nowrap tabular-nums">
            {listDate(message.receivedAt, locale, now)}
          </time>
        </span>
      </Link>
    </li>
  );
}

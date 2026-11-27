"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail } from "lucide-react";
import { useUnreadCount } from "@yourtal/mail-engine/react";
import { cn } from "@yourtal/ui/cn";
import { getNavTranslator } from "@/features/shell/nav-i18n";
import type { SupportedLocale } from "@/features/shell/nav-i18n";
import { countLabel } from "./mail-format";

/** The live unread count of the Inbox. Needs a `MailRoot` above it, which the shell mounts when mail is on. */
function UnreadBadge({ locale, className }: { locale: SupportedLocale; className?: string }) {
  const count = useUnreadCount("inbox");
  if (count <= 0) return null;
  const t = getNavTranslator(locale);
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="mail-unread-badge"
        className={cn(
          "inline-flex min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-caption font-sans font-bold tabular-nums text-fg-on-accent",
          className,
        )}
      >
        {countLabel(count)}
      </span>
      <span className="sr-only">{t("mailUnread", { count })}</span>
    </>
  );
}

export type MailNavVariant = "top" | "rail" | "menu";

/**
 * The Mail entry of the shell: an icon with the unread badge in the top bar, a row in the side rail
 * and one in the account menu. `on` is true only when the person has a mailbox (the shell mounted
 * the mail client); before that the link leads to the switch-on screen and shows no badge.
 */
export function MailNavLink({
  locale,
  on,
  variant,
  className,
  activeClassName,
}: {
  locale: SupportedLocale;
  on: boolean;
  variant: MailNavVariant;
  className: string;
  activeClassName?: string;
}) {
  const t = getNavTranslator(locale);
  const pathname = usePathname();
  const active = pathname === "/mail" || pathname.startsWith("/mail/");
  const label = t("mail");
  if (variant === "top") {
    return (
      <Link
        href="/mail"
        aria-current={active ? "page" : undefined}
        className={cn(className, active && activeClassName)}
      >
        <Mail aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">{label}</span>
        {on ? <UnreadBadge locale={locale} className="absolute -right-0.5 -top-0.5" /> : null}
      </Link>
    );
  }
  return (
    <Link
      href="/mail"
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
    >
      <Mail aria-hidden="true" className="h-5 w-5 shrink-0" />
      <span>{label}</span>
      {on ? <UnreadBadge locale={locale} className="ml-auto" /> : null}
    </Link>
  );
}

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail } from "lucide-react";
import { cn } from "@yourtal/ui/cn";
import { getNavTranslator } from "@/features/shell/nav-i18n";
import type { SupportedLocale } from "@/features/shell/nav-i18n";

/** Loaded after the page, with the mail engine behind it: nothing mail-related weighs on a first load. */
const MailUnreadBadge = dynamic(() => import("./mail-unread-badge"), { ssr: false });

function UnreadBadge({ locale, className }: { locale: SupportedLocale; className: string }) {
  const t = getNavTranslator(locale);
  return <MailUnreadBadge label={(count) => t("mailUnread", { count })} className={className} />;
}

export type MailNavVariant = "top" | "rail" | "menu";

/**
 * The Mail entry of the shell: an icon with the unread badge in the top bar, a row in the side rail
 * and one in the account menu. `on` is true only when the person has a mailbox; before that the
 * link leads to the switch-on screen and shows no badge.
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

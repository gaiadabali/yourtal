"use client";

import Link from "next/link";
import { Flame, Search } from "lucide-react";
import type { ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import { Input } from "@yourtal/ui/input";
import { PointsChip } from "@yourtal/ui/points-chip";
import type { Notification } from "@yourtal/contracts/me/notification";
import { NotificationsBell } from "../notifications/notifications-bell";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";
import { AccountMenu, type AccountSummary } from "./account-menu";
import { Wordmark } from "./wordmark";

export interface TopBarProps {
  locale: SupportedLocale;
  /** The signed-in viewer's spendable points, shown in the PointsChip. Ignored when `signedOut` is set. */
  availablePoints: number;
  /**
   * 11.7.a: the signed-in viewer's notifications, server-fetched once at
   * shell render time. Omitted (no bell rendered) when `signedOut` is set —
   * `GET /api/me/notifications` needs a session, and a bell that always
   * opens empty for a logged-out visitor is worse than no bell.
   */
  notifications?: readonly Notification[];
  /** Where the wordmark links home. Defaults to `/home` (the signed-in tab) — F79's anonymous caller passes its own public locale root instead. */
  homeHref?: string;
  /**
   * F79: renders "Sign up to earn" in place of the points chip, and drops
   * the search form — `/store?q=` has no anonymous-readable counterpart
   * (the public rewards catalogue this ticket also links from the nav has
   * no search of its own yet), and a search box that dead-ends is worse
   * than no search box.
   */
  signedOutCta?: { href: string; label: string };
  /** 13.18.b: the signed-in account for the avatar menu. Omitted, no avatar shows. */
  account?: AccountSummary;
  theme?: ThemeSetting;
  /** 13.13.d: 0 hides the badge. */
  streakDays?: number;
}

/**
 * The viewer's top bar. 13.18: the logo moves to the side rail from lg, so
 * this holds search, notifications, points and the account menu. Below md,
 * search is an icon link to `/search`. `sticky`, not `fixed`, so the staging
 * banner above it keeps its place. Search is a plain GET form that works
 * before hydration.
 */
export function TopBar({
  locale,
  availablePoints,
  notifications,
  homeHref = "/home",
  signedOutCta,
  account,
  theme = "system",
  streakDays = 0,
}: TopBarProps) {
  const t = getNavTranslator(locale);

  return (
    <header className="sticky top-0 z-(--z-nav) flex h-14 items-center gap-2 border-b border-border-subtle bg-surface/95 px-gutter-sm backdrop-blur md:gap-3 md:px-gutter-md lg:pl-[calc(14rem+var(--spacing-gutter-md))]">
      {/* 13.18.a: from lg the logo lives at the top of the side rail. */}
      <div className="shrink-0 lg:hidden">
        {signedOutCta ? (
          // Plain `<a>`: `homeHref` may be a public locale route outside the typed tab graph.
          <a href={homeHref}>
            <Wordmark />
          </a>
        ) : (
          <Link href="/home">
            <Wordmark />
          </Link>
        )}
      </div>
      {signedOutCta ? (
        <div className="min-w-0 flex-1" />
      ) : (
        <>
          <form
            action="/search"
            method="get"
            role="search"
            className="hidden min-w-0 flex-1 justify-center md:flex"
          >
            <div className="w-full max-w-xl">
              <Input
                type="search"
                name="q"
                label={t("searchLabel")}
                hideLabel
                placeholder={t("searchPlaceholder")}
              />
            </div>
          </form>
          <div className="min-w-0 flex-1 md:hidden" />
          <Link
            href="/search"
            aria-label={t("search")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill text-fg hover:bg-surface-sunken md:hidden"
          >
            <Search aria-hidden="true" className="h-5 w-5" />
          </Link>
        </>
      )}
      {signedOutCta ? (
        <a
          href={signedOutCta.href}
          className="inline-flex h-8 shrink-0 items-center rounded-pill bg-accent px-3 text-label font-sans font-bold text-fg-on-accent"
        >
          {signedOutCta.label}
        </a>
      ) : (
        <>
          {streakDays > 0 ? (
            <span
              className="hidden h-8 shrink-0 items-center gap-1 rounded-pill bg-accent-subtle px-2.5 text-label font-sans font-bold text-fg sm:inline-flex"
              title={t("streak", { count: streakDays })}
            >
              <Flame aria-hidden="true" className="h-4 w-4 text-accent" />
              <span aria-hidden="true" className="tabular-nums">
                {streakDays}
              </span>
              <span className="sr-only">{t("streak", { count: streakDays })}</span>
            </span>
          ) : null}
          {notifications ? <NotificationsBell initialNotifications={notifications} /> : null}
          <Link href="/wallet" className="shrink-0 rounded-pill">
            <PointsChip
              value={availablePoints}
              size="sm"
              locale={locale}
              formatLabel={(formatted) => t("pointsAvailable", { points: formatted })}
            />
          </Link>
          {account ? <AccountMenu locale={locale} account={account} theme={theme} /> : null}
        </>
      )}
    </header>
  );
}

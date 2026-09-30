"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  CircleUserRound,
  HeartHandshake,
  LogOut,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { Text } from "@yourtal/ui/text";
import { cn } from "@yourtal/ui/cn";
import { logoutAction, updateMeAction } from "@/lib/api/actions";
import { setThemeAction } from "@/features/me/me-actions";
import { clearSessionScopedServiceWorkerCache } from "./clear-session-cache";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";

export interface AccountSummary {
  displayName: string;
  email: string | null;
  hasStudio: boolean;
  hasStaff: boolean;
  /** F86: adults only. */
  hasAuctions: boolean;
}

export interface AccountMenuProps {
  locale: SupportedLocale;
  account: AccountSummary;
  theme: ThemeSetting;
}

const ROW =
  "flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-body-sm font-sans font-medium " +
  "text-fg transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken";

/** Pins `data-theme` on `<html>` straight away, so the change shows before the refresh lands. */
function applyTheme(theme: ThemeSetting) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = theme;
}

/**
 * 13.18.b: the avatar at the top right and its menu. A disclosure, not an
 * ARIA `menu`: it holds a radiogroup and forms, which a menu role cannot.
 */
export function AccountMenu({ locale, account, theme: initialTheme }: AccountMenuProps) {
  const t = getNavTranslator(locale);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeSetting>(initialTheme);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A route change closes the menu, like following any link in it should.
  useEffect(() => setOpen(false), [pathname]);

  function changeTheme(next: ThemeSetting) {
    const previous = theme;
    setTheme(next);
    setFailed(false);
    applyTheme(next);
    startTransition(async () => {
      const result = await setThemeAction(next);
      if (!result.ok) {
        setTheme(previous);
        applyTheme(previous);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      {/* eslint-disable-next-line yt-b/prefer-primitives -- an avatar trigger, not a labelled Button */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("accountMenu")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex rounded-pill ring-offset-2 ring-offset-surface transition-shadow",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          open && "ring-2 ring-accent",
        )}
      >
        <ChannelAvatar name={account.displayName} size="sm" decorative />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn(
          "absolute right-0 top-[calc(100%+0.5rem)] z-(--z-overlay) w-[min(20rem,calc(100vw-1.5rem))]",
          "rounded-card border border-border-subtle bg-surface-raised p-2 shadow-lg",
        )}
      >
        <div className="flex items-center gap-3 px-3 pb-3 pt-2">
          <ChannelAvatar name={account.displayName} size="md" decorative />
          <div className="min-w-0">
            <Text size="body" className="truncate font-bold">
              {account.displayName}
            </Text>
            {account.email ? (
              <Text size="body-sm" tone="muted" className="truncate">
                {account.email}
              </Text>
            ) : null}
          </div>
        </div>
        <div className="border-t border-border-subtle py-1">
          <Link href="/me" className={ROW}>
            <CircleUserRound aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            {t("me")}
          </Link>
          <Link href="/wallet" className={ROW}>
            <Wallet aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            {t("wallet")}
          </Link>
          {account.hasAuctions ? (
            <Link href="/auctions" className={ROW}>
              <HeartHandshake aria-hidden="true" className="h-5 w-5 text-fg-muted" />
              {t("auctions")}
            </Link>
          ) : null}
          {account.hasStudio ? (
            <a href="/studio" className={ROW}>
              <Briefcase aria-hidden="true" className="h-5 w-5 text-fg-muted" />
              {t("studio")}
            </a>
          ) : null}
          {account.hasStaff ? (
            <a href="/staff" className={ROW}>
              <ShieldCheck aria-hidden="true" className="h-5 w-5 text-fg-muted" />
              {t("staffConsole")}
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 border-t border-border-subtle px-3 py-3">
          <Text size="caption" tone="muted" className="font-bold">
            {t("theme")}
          </Text>
          <SegmentedControl
            label={t("theme")}
            value={theme}
            onChange={changeTheme}
            className="w-full [&>button]:flex-1"
            options={[
              { value: "system", label: t("themeSystem") },
              { value: "light", label: t("themeLight") },
              { value: "dark", label: t("themeDark") },
            ]}
          />
          {failed ? (
            <Text size="caption" tone="danger" role="alert">
              {t("themeSaveFailed")}
            </Text>
          ) : null}
        </div>
        <form
          action={updateMeAction}
          className="flex flex-col gap-2 border-t border-border-subtle px-3 py-3"
        >
          {/* eslint-disable-next-line yt-b/prefer-primitives -- a hidden field has no UI to wrap */}
          <input type="hidden" name="returnTo" value={pathname} />
          <Text size="caption" tone="muted" className="font-bold">
            {t("language")}
          </Text>
          <div className="flex gap-1 rounded-control bg-surface-sunken p-1">
            {(["en-AU", "id-ID"] as const).map((value) => (
              // eslint-disable-next-line yt-b/prefer-primitives -- a two-way segment that submits the form
              <button
                key={value}
                type="submit"
                name="displayLocale"
                value={value}
                aria-pressed={locale === value}
                className={cn(
                  "flex-1 rounded-control px-2 py-1.5 text-label font-sans font-medium",
                  locale === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                )}
              >
                {value === "en-AU" ? t("languageEnAU") : t("languageIdID")}
              </button>
            ))}
          </div>
        </form>
        <form
          action={logoutAction}
          onSubmit={() => clearSessionScopedServiceWorkerCache()}
          className="border-t border-border-subtle pt-1"
        >
          {/* eslint-disable-next-line yt-b/prefer-primitives -- a menu row, styled like the links above */}
          <button type="submit" className={ROW}>
            <LogOut aria-hidden="true" className="h-5 w-5 text-fg-muted" />
            {t("logOut")}
          </button>
        </form>
      </div>
    </div>
  );
}

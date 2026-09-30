import type { ReactNode } from "react";
import { cn } from "@yourtal/ui/cn";
import type { Notification } from "@yourtal/contracts/me/notification";
import type { ThemeSetting } from "@yourtal/contracts/me/theme-setting";
import type { AccountSummary } from "./account-menu";
import { BottomNav } from "./bottom-nav";
import type { SupportedLocale } from "./nav-i18n";
import type { NavLabelKey } from "./nav-items";
import { SideNav } from "./side-nav";
import { TopBar } from "./top-bar";

/**
 * F79: the same shell for an anonymous visitor as a signed-in one — Home
 * and Store keep working (their own public destinations), Watch/Wallet/Me
 * point at sign-in, and the top bar shows a "sign up to earn" CTA instead
 * of the points chip. `apps/web/proxy.ts` (Area A) is not touched by this:
 * these are just where the NAV LINKS point, not a change to which routes
 * are gated.
 */
export interface ViewerShellSignedOutProps {
  /** Wordmark link target — the public locale root (`/au`/`/id`), not `/home`. */
  homeHref: string;
  hrefs: Readonly<Record<NavLabelKey, string>>;
  signUpHref: string;
  signUpLabel: string;
}

export interface ViewerShellProps {
  locale: SupportedLocale;
  /** The signed-in viewer's spendable points, shown in the top bar's chip. Unused when `signedOut` is set (kept required so every existing signed-in caller is unaffected). */
  availablePoints: number;
  /** 11.7.a: the signed-in viewer's notifications for the top bar's bell. Omit (or leave unset) for a signed-out shell — `TopBar` shows no bell then either way. */
  notifications?: readonly Notification[];
  /**
   * 13.16.a: the viewer's saved theme, for the account menu's control. The
   * colours come from `data-theme` on `<html>` (RootDocument).
   */
  theme?: ThemeSetting;
  /** 13.13.d: the current streak for the header badge; 0 hides it. */
  streakDays?: number;
  /** Pins one theme on this subtree only, for the gallery. */
  forceTheme?: "light" | "dark";
  /** 13.18.b: the signed-in account for the header's avatar menu. */
  account?: AccountSummary;
  signedOut?: ViewerShellSignedOutProps;
  children: ReactNode;
}

/**
 * The five-tab consumer shell (task 3.5.c, replacing what `app-shell.tsx`
 * used to render directly). Reused as-is by the gallery
 * (`app/(lab)/lab/ui/groups/shells.tsx`) and by the real app
 * (`app-shell.tsx`) — which is why it takes `locale` and `availablePoints`
 * as plain props rather than resolving the region cookie or a wallet read
 * itself. `region-context.tsx`'s doc comment spells out the underlying
 * rule: "a Client Component can hold Server Component children, it just
 * cannot import or render them itself." The gallery's `ShellsGroup` is a
 * Client Component, so it can only render this tree directly if nothing in
 * it has a server-only import — `app-shell.tsx` (a Server Component) is
 * where the region cookie actually gets read, once, and handed down.
 *
 * `data-surface="viewer"` and `data-theme` on the root are what every token
 * in `packages/ui/src/styles/tokens.css` keys off.
 *
 * Layout stability: `<main>` reserves the exact space the fixed bottom nav
 * and sticky top bar occupy (bottom pad on mobile sized to the bottom bar's
 * height plus its safe-area inset, left pad from `lg` sized to the side
 * rail) so content never renders under the chrome, and the reserved space
 * itself never changes across a route change — the shell's own contribution
 * to CLS is zero by construction.
 */
export function ViewerShell({
  locale,
  availablePoints,
  notifications,
  theme = "system",
  forceTheme,
  streakDays = 0,
  account,
  signedOut,
  children,
}: ViewerShellProps) {
  // Built as spreads, not `prop={signedOut?.x}`: `exactOptionalPropertyTypes`
  // treats an explicitly-assigned `undefined` as different from an omitted
  // key, so an inline `| undefined` value fails the optional prop's own
  // type even though the prop is optional (TopBar/SideNav/BottomNav's own
  // `signedOutHrefs?`/`homeHref?`). Omitting the key entirely when there is
  // no `signedOut` is what those types actually ask for.
  const topBarSignedOutProps = signedOut
    ? {
        homeHref: signedOut.homeHref,
        signedOutCta: { href: signedOut.signUpHref, label: signedOut.signUpLabel },
      }
    : {};
  const navSignedOutProps = signedOut ? { signedOutHrefs: signedOut.hrefs } : {};
  // Same `exactOptionalPropertyTypes` reasoning as above: omit the key
  // entirely rather than pass `notifications: undefined` when there is none.
  const topBarNotificationsProps = notifications ? { notifications } : {};
  const topBarAccountProps = account && !signedOut ? { account } : {};

  return (
    <div data-surface="viewer" data-theme={forceTheme} className="min-h-dvh bg-canvas text-fg">
      <TopBar
        locale={locale}
        availablePoints={availablePoints}
        theme={theme}
        streakDays={signedOut ? 0 : streakDays}
        {...topBarSignedOutProps}
        {...topBarNotificationsProps}
        {...topBarAccountProps}
      />
      <SideNav
        locale={locale}
        {...navSignedOutProps}
        {...(signedOut ? { homeHref: signedOut.homeHref } : {})}
      />
      <main
        className={cn(
          "min-h-dvh pb-[calc(4rem+max(0px,env(safe-area-inset-bottom)))]",
          "lg:pb-0 lg:pl-56",
        )}
      >
        {children}
      </main>
      <BottomNav locale={locale} {...navSignedOutProps} />
    </div>
  );
}

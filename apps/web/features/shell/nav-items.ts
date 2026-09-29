import { CircleUserRound, Home, PlayCircle, Store, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SupportedLocale } from "./nav-i18n";

/**
 * The five tabs, in the fixed order set by docs/17-surfaces-and-roles.md:1,
 * relabelled Home · Watch · Store · Wallet · Me by task 3.5.c (was Earn ·
 * Quick). `href` is the tab's own route; `matchPrefixes` lists additional
 * route subtrees that belong to this tab without living under its path —
 * Home's entry (`/campaign/[id]`) is reached from the home board but is not
 * itself a tab route.
 *
 * Watch points at `/watch` (11.7.d, founder demo), a real destination now
 * — a YouTube-style grid of long-form campaigns — rather than `/quick`,
 * which used to stand in for it and now only redirects to Home (11.4.b).
 * `/watch/[id]` (the campaign page) is Watch's own subtree via its own
 * `href`, so it is deliberately NOT also in Home's `matchPrefixes` any
 * more: before this task both tabs claimed it, which would have
 * highlighted Home and Watch simultaneously on a campaign page.
 *
 * `labelKey` (YT-0058), not `label`: this list is a plain data module with
 * no locale of its own, and a hardcoded English `label` here was exactly
 * the "no hard-coded user-facing string anywhere" gap this ticket exists
 * to close — every other visitor-facing surface reads its copy from
 * `messages/<locale>/*.json`, and the five primary tab labels were the one
 * screen every user sees that did not. `labelKey` indexes `nav.json`
 * (`nav-i18n.ts`); `bottom-nav.tsx`/`side-nav.tsx` resolve it with the
 * request's actual locale before rendering.
 */
// A literal union, not `string` — next.config.ts sets `typedRoutes: true`,
// so `next/link`'s `href` only accepts a route Next recognises at build
// time. Keeping this list literal (rather than widened to `string`) is what
// lets `<Link href={item.href}>` in nav-link.tsx typecheck against Next's
// generated route types.
export type TabHref = "/home" | "/watch" | "/store" | "/wallet" | "/me";

export type NavLabelKey = "home" | "watch" | "store" | "wallet" | "me";

export interface NavItem {
  href: TabHref;
  labelKey: NavLabelKey;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
}

export const navItems: readonly NavItem[] = [
  { href: "/home", labelKey: "home", icon: Home, matchPrefixes: ["/campaign"] },
  { href: "/watch", labelKey: "watch", icon: PlayCircle },
  { href: "/store", labelKey: "store", icon: Store },
  { href: "/wallet", labelKey: "wallet", icon: Wallet },
  { href: "/me", labelKey: "me", icon: CircleUserRound },
];

export type { SupportedLocale };

/**
 * Pure route-matching logic, kept separate from the client leaf that calls
 * it (`nav-link.tsx`) so it is unit-testable without rendering React or
 * mocking `usePathname`. Takes primitives rather than a `NavItem` on
 * purpose: `nav-link.tsx` is a Client Component, and a `NavItem`'s `icon`
 * is a component reference, which the RSC boundary cannot serialise as a
 * prop — only `href` and `matchPrefixes` (plain strings) cross it.
 *
 * A prefix matches the pathname itself or any of its subroutes
 * (`/wallet` matches `/wallet` and `/wallet/history`, never `/walletx`).
 */
export function isActiveTab(
  pathname: string,
  href: TabHref,
  matchPrefixes?: readonly string[],
): boolean {
  const prefixes: readonly string[] = [href, ...(matchPrefixes ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

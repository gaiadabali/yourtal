import { CircleUserRound, Clapperboard, Home, Store, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SupportedLocale } from "./nav-i18n";

/**
 * The five tabs, Home · Shorts · Store · Wallet · Me (13.14.b). `matchPrefixes`
 * lists routes that belong to a tab without living under its path: a long
 * video's `/watch/[id]` page is reached from Home. `labelKey` indexes
 * `nav.json`, resolved per request locale by the nav components.
 */
// A literal union, not `string` — next.config.ts sets `typedRoutes: true`,
// so `next/link`'s `href` only accepts a route Next recognises at build
// time. Keeping this list literal (rather than widened to `string`) is what
// lets `<Link href={item.href}>` in nav-link.tsx typecheck against Next's
// generated route types.
export type TabHref = "/home" | "/shorts" | "/store" | "/wallet" | "/me";

export type NavLabelKey = "home" | "shorts" | "store" | "wallet" | "me";

export interface NavItem {
  href: TabHref;
  labelKey: NavLabelKey;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
}

export const navItems: readonly NavItem[] = [
  // 13.13/13.14: long videos (and their watch pages) are Home; Shorts has its own tab.
  { href: "/home", labelKey: "home", icon: Home, matchPrefixes: ["/watch", "/campaign"] },
  { href: "/shorts", labelKey: "shorts", icon: Clapperboard },
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

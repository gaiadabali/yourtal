import { CircleUserRound, Coins, Store, Wallet, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The five tabs, in the fixed order set by docs/17-surfaces-and-roles.md:1
 * (Earn · Quick · Store · Wallet · Me). `href` is the tab's own route;
 * `matchPrefixes` lists additional route subtrees that belong to this tab
 * without living under its path — Earn's entry (`/campaign/[id]`) and watch
 * (`/watch/[id]`) flows are reached from the Earn board but are not
 * themselves tab routes.
 */
// A literal union, not `string` — next.config.ts sets `typedRoutes: true`,
// so `next/link`'s `href` only accepts a route Next recognises at build
// time. Keeping this list literal (rather than widened to `string`) is what
// lets `<Link href={item.href}>` in nav-link.tsx typecheck against Next's
// generated route types.
export type TabHref = "/" | "/quick" | "/store" | "/wallet" | "/me";

export interface NavItem {
  href: TabHref;
  label: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
}

export const navItems: readonly NavItem[] = [
  { href: "/", label: "Earn", icon: Coins, matchPrefixes: ["/campaign", "/watch"] },
  { href: "/quick", label: "Quick", icon: Zap },
  { href: "/store", label: "Store", icon: Store },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/me", label: "Me", icon: CircleUserRound },
];

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
export function isActiveTab(pathname: string, href: TabHref, matchPrefixes?: readonly string[]): boolean {
  const prefixes: readonly string[] = [href, ...(matchPrefixes ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

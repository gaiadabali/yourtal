"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@yourtal/ui/cn";
import { isActiveTab } from "./nav-items";
import type { TabHref } from "./nav-items";

/**
 * YT-0402: this is the *only* client boundary in the app shell.
 *
 * `layout.tsx`, `app-shell.tsx`, `bottom-nav.tsx` and `side-nav.tsx` are all
 * Server Components — the tab bar's structure, icons and labels never touch
 * the client bundle themselves: each Lucide icon is instantiated with JSX
 * (`<Icon />`) in the Server Component caller and passed in as `children`,
 * which crosses the RSC boundary as ordinary serialized element output, not
 * client JS. Only `href` and `matchPrefixes` (plain strings) are passed as
 * props — deliberately not the `NavItem` object itself, whose `icon` field
 * is a component *reference* and cannot cross the server-to-client prop
 * boundary at all (React throws "Functions cannot be passed directly to
 * Client Components" at runtime; this is invisible to `tsc`, only a
 * dev-server render catches it — see the ticket report).
 *
 * The one thing a Server Component genuinely cannot do is know which tab is
 * "current" — that requires the browser's URL, which is client-only state
 * in Next's App Router (docs/13b-typescript-standards.md §8: push
 * "use client" to the smallest leaf rather than layout.tsx/page.tsx/
 * template.tsx). This file is that leaf: it renders nothing itself beyond a
 * <Link>, calls `usePathname()` once, and defers the match logic to the
 * pure, separately-tested `isActiveTab` (see nav-items.test.ts).
 */
export interface NavLinkProps {
  href: TabHref;
  // `| undefined` is explicit, not redundant: tsconfig sets
  // `exactOptionalPropertyTypes: true`, so `matchPrefixes={item.matchPrefixes}`
  // (a NavItem's own optional field, typed `readonly string[] | undefined`)
  // needs the prop's type to admit `undefined` as an explicitly-passed value,
  // not just an omitted key.
  matchPrefixes?: readonly string[] | undefined;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}

export function NavLink({
  href,
  matchPrefixes,
  className,
  activeClassName,
  children,
}: NavLinkProps) {
  const pathname = usePathname();
  const isActive = isActiveTab(pathname, href, matchPrefixes);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(className, isActive && activeClassName)}
    >
      {children}
    </Link>
  );
}

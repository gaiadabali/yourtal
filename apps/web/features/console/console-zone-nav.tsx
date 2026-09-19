"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@yourtal/ui/cn";
import type { ConsoleNavItem } from "./console-zone-items";
import { isActiveZone } from "./console-zone-items";

export interface ConsoleZoneNavProps {
  items: readonly ConsoleNavItem[];
  /** `""` or `"?business=<id>"` — carries the selected business across zone tabs (docs/13b §8: URL first for shareable, back-button-correct state). */
  businessQuery: string;
}

/**
 * The console's own zone tabs — this console's equivalent of
 * `features/shell/nav-link.tsx`/`bottom-nav.tsx`, not a reuse of the
 * consumer shell's five-tab bar (that bar has no "Business" entry and is
 * mobile-first; this one is desktop-first per YT-0440). This is the one
 * client leaf in the zone-tabs subtree — `console-header.tsx`, which
 * renders it, stays a Server Component.
 */
export function ConsoleZoneNav({ items, businessQuery }: ConsoleZoneNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Business console zones"
      className="flex flex-wrap gap-1 border-b border-border pb-2"
    >
      {items.map((item) => {
        const isActive = isActiveZone(pathname, item.href);
        const href = `${item.href}${businessQuery}` as Route;
        return (
          <Link
            key={item.zone}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-sans font-medium text-fg-muted transition-colors hover:bg-surface-raised",
              isActive && "bg-surface-raised text-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@yourtal/ui/cn";
import type { StudioNavItem } from "./studio-zone-items";
import { isActiveZone } from "./studio-zone-items";

export interface StudioZoneNavProps {
  items: readonly StudioNavItem[];
  /** `""` or `"?business=<id>"` — carries the selected business across zone tabs (docs/13b §8: URL first for shareable, back-button-correct state). */
  businessQuery: string;
}

const ZONE_LINK_CLASS =
  "shrink-0 rounded-control px-3 py-2 text-label font-sans font-medium text-fg-muted transition-colors hover:bg-surface-sunken";

/**
 * Studio's zone tabs — a plain fragment of links, not its own `<nav>`:
 * `studio-chrome.tsx` renders exactly one `<nav>` for the whole sidebar
 * (identity panel + these links together), so each link here becomes that
 * `<nav>`'s direct flex child.
 */
export function StudioZoneNav({ items, businessQuery }: StudioZoneNavProps) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const isActive = isActiveZone(pathname, item.href);
        const href = `${item.href}${businessQuery}` as Route;
        return (
          <Link
            key={item.zone}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(ZONE_LINK_CLASS, isActive && "bg-surface-sunken text-fg")}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

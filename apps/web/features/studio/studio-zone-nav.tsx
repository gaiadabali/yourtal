"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
 * Studio's zone tabs, passed as `StudioShell`'s `nav` slot
 * (`packages/ui/src/studio-shell/studio-shell.tsx`), alongside
 * `StudioIdentityPanel` as a sibling flex item — this `<nav>` mirrors the
 * shell's own responsive direction (`lg:flex-col`) rather than using
 * `display: contents` to make each link a direct flex child of the shell's
 * container: a `contents` element reports no box of its own, which would
 * make `tablet-768.spec.ts`'s overflow check measure nothing.
 */
export function StudioZoneNav({ items, businessQuery }: StudioZoneNavProps) {
  const t = useTranslations("studio");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("chrome.zoneNav.ariaLabel")}
      className="flex min-w-0 flex-1 flex-wrap gap-1 lg:w-full lg:flex-none lg:flex-col lg:gap-0.5"
    >
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
    </nav>
  );
}

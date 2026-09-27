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
 * (`packages/ui/src/studio-shell/studio-shell.tsx`). `className="contents"`
 * on the wrapping `<nav>` keeps the a11y landmark without taking it out of
 * the shell's own flex layout — the shell's container switches its own
 * flex-direction between a horizontal strip below `lg` and a sidebar at
 * `lg`, and each link needs to be that container's direct flex child for
 * either to work, exactly like the plain-fragment example in the shell's
 * own gallery entry (`(lab)/lab/ui/groups/shells.tsx`).
 */
export function StudioZoneNav({ items, businessQuery }: StudioZoneNavProps) {
  const t = useTranslations("studio");
  const pathname = usePathname();

  return (
    <nav aria-label={t("chrome.zoneNav.ariaLabel")} className="contents">
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

"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@yourtal/ui/cn";

export interface StaffNavItem {
  readonly href: Route;
  readonly label: string;
}

const LINK_CLASS =
  "shrink-0 rounded-control px-3 py-2 text-label font-sans font-medium text-fg-muted transition-colors hover:bg-surface-sunken";

/** The console's section links; the active one is marked for assistive tech too. */
export function StaffNav({ items }: { items: readonly StaffNavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active =
          item.href === "/staff" ? pathname === "/staff" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(LINK_CLASS, active && "bg-surface-sunken text-fg")}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

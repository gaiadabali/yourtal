import Link from "next/link";
import type { Route } from "next";
import { cn } from "@yourtal/ui/cn";

export interface StaffEconomySubnavProps {
  readonly active: "overview" | "rate" | "marketing" | "settings";
  readonly region: "AU" | "ID";
  readonly showRate: boolean;
  readonly t: (key: string) => string;
}

/** The economy zone's own four screens (9.5.a-d) -- `staff-nav.tsx` only tracks top-level zones. */
export function StaffEconomySubnav({ active, region, showRate, t }: StaffEconomySubnavProps) {
  const items: { key: StaffEconomySubnavProps["active"]; href: Route; label: string }[] = [
    {
      key: "overview",
      href: `/staff/economy?region=${region}` as Route,
      label: t("economy.tabOverview"),
    },
    ...(showRate
      ? [
          {
            key: "rate" as const,
            href: `/staff/economy/rate?region=${region}` as Route,
            label: t("economy.tabRate"),
          },
        ]
      : []),
    {
      key: "marketing",
      href: `/staff/economy/marketing?region=${region}` as Route,
      label: t("economy.tabMarketing"),
    },
    {
      key: "settings",
      href: `/staff/economy/settings?region=${region}` as Route,
      label: t("economy.tabSettings"),
    },
  ];
  return (
    <nav aria-label={t("economy.subnavLabel")} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={cn(
            "rounded-control px-3 py-1.5 text-label font-sans font-medium",
            item.key === active
              ? "bg-surface-sunken text-fg"
              : "text-fg-muted hover:bg-surface-sunken",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

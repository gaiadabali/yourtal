import type { StudioZone } from "./studio-zone-access";
import { zoneLabel } from "./studio-zone-access";

/**
 * Zone -> route mapping and pure active-tab logic, mirroring
 * `features/shell/nav-items.ts`'s split. Kept separate from the client leaf
 * that renders it (`studio-zone-nav.tsx`) for the same reason: unit-testable
 * without rendering React or mocking `usePathname`.
 */
export type ZonePath =
  | "/studio"
  | "/studio/campaigns"
  | "/studio/inventory"
  | "/studio/reports"
  | "/studio/billing"
  | "/studio/billing/invoices"
  | "/studio/team"
  | "/studio/redemptions"
  | "/studio/developers"
  | "/studio/channel";

const ZONE_PATHS: Record<StudioZone, ZonePath> = {
  campaigns: "/studio/campaigns",
  inventory: "/studio/inventory",
  reports: "/studio/reports",
  billing: "/studio/billing",
  team: "/studio/team",
  redemptions: "/studio/redemptions",
  developers: "/studio/developers",
  channel: "/studio/channel",
};

/** A nav entry: a zone, or the Invoices page that sits under Billing. */
export type StudioNavZone = StudioZone | "invoices";

export interface StudioNavItem {
  zone: StudioNavZone;
  href: ZonePath;
  label: string;
  /** One-line description for the overview grid. */
  blurb: string;
}

/** Builds the ordered nav item list for exactly the zones `visibleZones` allows. */
export function buildStudioNavItems(
  visibleZones: readonly StudioZone[],
  t: (key: string) => string,
): StudioNavItem[] {
  return visibleZones.flatMap((zone): StudioNavItem[] => {
    const item = {
      zone,
      href: ZONE_PATHS[zone],
      label: zoneLabel(t, zone),
      blurb: t(`zoneBlurbs.${zone}`),
    };
    // Invoices need the same access as Billing (the API's `billing` view), so they follow it.
    return zone === "billing"
      ? [
          item,
          {
            zone: "invoices",
            href: "/studio/billing/invoices",
            label: t("zones.invoices"),
            blurb: t("zoneBlurbs.invoices"),
          },
        ]
      : [item];
  });
}

/**
 * A path matches its own zone exactly, never a prefix — unlike the consumer
 * shell's tabs (`/wallet` matches `/wallet/history`), every zone here is a
 * single flat page with no owned sub-routes yet, so a prefix match would
 * wrongly light up "Campaigns" while on the overview page (a literal
 * string-prefix match of "/studio" would match every zone path).
 */
export function isActiveZone(pathname: string, href: ZonePath): boolean {
  return pathname === href;
}

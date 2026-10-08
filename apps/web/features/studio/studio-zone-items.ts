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

export interface StudioNavItem {
  zone: StudioZone;
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
  return visibleZones.map((zone) => ({
    zone,
    href: ZONE_PATHS[zone],
    label: zoneLabel(t, zone),
    blurb: t(`zoneBlurbs.${zone}`),
  }));
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

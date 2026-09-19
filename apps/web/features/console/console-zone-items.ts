import type { ConsoleZone } from "./console-zone-access";
import { ZONE_LABELS } from "./console-zone-access";

/**
 * Zone -> route mapping and pure active-tab logic, mirroring
 * `features/shell/nav-items.ts` exactly (YT-0440 is told to follow that
 * pattern, not reinvent it). Kept separate from the client leaf that
 * renders it (`console-zone-nav.tsx`) for the same reason: unit-testable
 * without rendering React or mocking `usePathname`.
 */
export type ZonePath =
  | "/business"
  | "/business/campaigns"
  | "/business/inventory"
  | "/business/redemption"
  | "/business/reports"
  | "/business/billing"
  | "/business/team";

const ZONE_PATHS: Record<ConsoleZone, ZonePath> = {
  campaigns: "/business/campaigns",
  inventory: "/business/inventory",
  redemption: "/business/redemption",
  reports: "/business/reports",
  billing: "/business/billing",
  team: "/business/team",
};

export interface ConsoleNavItem {
  zone: ConsoleZone;
  href: ZonePath;
  label: string;
}

/** Builds the ordered nav item list for exactly the zones `visibleZones` allows. */
export function buildConsoleNavItems(visibleZones: readonly ConsoleZone[]): ConsoleNavItem[] {
  return visibleZones.map((zone) => ({ zone, href: ZONE_PATHS[zone], label: ZONE_LABELS[zone] }));
}

/**
 * A path matches its own zone exactly, never a prefix — unlike the consumer
 * shell's tabs (`/wallet` matches `/wallet/history`), every zone here is a
 * single flat page with no owned sub-routes yet, so a prefix match would
 * wrongly light up "Campaigns" while on the console's own overview page (a
 * literal string-prefix match of "/business" would match every zone path).
 */
export function isActiveZone(pathname: string, href: ZonePath): boolean {
  return pathname === href;
}

import type { Route } from "next";
import type { StaffRole } from "@yourtal/contracts/staff/session";

export interface StaffZone {
  readonly key: string;
  readonly href: Route;
  /** Who sees it in the nav. A courtesy only: each zone's API is Cerbos-gated on its own. */
  readonly roles: readonly StaffRole[];
}

const EVERY_WORKING_ROLE: readonly StaffRole[] = [
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
];

/** One entry per built console section; later Phase 9 tasks add theirs here. */
export const STAFF_ZONES: readonly StaffZone[] = [
  { key: "overview", href: "/staff", roles: EVERY_WORKING_ROLE },
  { key: "businesses", href: "/staff/businesses", roles: ["ops"] },
  { key: "moderation", href: "/staff/moderation", roles: ["moderator"] },
];

export function zonesFor(roles: readonly StaffRole[]): readonly StaffZone[] {
  return STAFF_ZONES.filter((zone) => zone.roles.some((role) => roles.includes(role)));
}

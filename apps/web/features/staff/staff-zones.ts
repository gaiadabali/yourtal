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
  // TASKS.md 9.4: users and support. A courtesy list here -- the API's own
  // user_account.yaml is the real gate (risk suspends/reinstates/sets the
  // trust tier; support opens cases and issues goodwill; both search/view).
  { key: "users", href: "/staff/users", roles: ["support", "risk_analyst"] },
  // TASKS.md 9.4.d, K13: the captured-voucher dispute queue -- support and
  // finance, per voucher_dispute.yaml.
  { key: "disputes", href: "/staff/disputes", roles: ["support", "finance"] },
];

export function zonesFor(roles: readonly StaffRole[]): readonly StaffZone[] {
  return STAFF_ZONES.filter((zone) => zone.roles.some((role) => roles.includes(role)));
}

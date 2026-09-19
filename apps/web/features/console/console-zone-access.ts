import type { BusinessRole as BusinessRelationship } from "@yourtal/contracts/business";
import type { BusinessTeamRole as ConsoleRole } from "@yourtal/contracts/business/team-role";

/**
 * The six dashboard zones (docs/17-surfaces-and-roles.md §2). Billing has
 * no ticket in this phase (see docs/tasks/phase-u-ui.md) and Redemption's
 * real content is the separate merchant portal (YT-0445/0446); both still
 * get a zone slot here because the shell (YT-0440) must render the zone
 * structure honestly, including the zones this batch does not build
 * content for yet.
 */
export const CONSOLE_ZONES = [
  "campaigns",
  "inventory",
  "redemption",
  "reports",
  "billing",
  "team",
] as const;
export type ConsoleZone = (typeof CONSOLE_ZONES)[number];

export const ZONE_LABELS: Record<ConsoleZone, string> = {
  campaigns: "Campaigns",
  inventory: "Inventory",
  redemption: "Redemption",
  reports: "Reports",
  billing: "Billing",
  team: "Team",
};

interface ZoneAccessRule {
  /**
   * The business relationship that must be held for this zone to appear at
   * all (docs/17 §2: "A business may hold any subset of three relationships
   * ... so the dashboard has three zones and shows only the ones they
   * use"). `null` means the zone is not relationship-gated — Reports,
   * Billing and Team apply regardless of which of the three relationships
   * a business holds.
   */
  relationship: BusinessRelationship | null;
  /** Roles that may open the zone at all — transcribed from `policies/derived_roles/business.yaml`. */
  view: readonly ConsoleRole[];
  /** Roles that may change something inside the zone (a subset of `view`). */
  edit: readonly ConsoleRole[];
}

/**
 * Transcribed directly from `policies/derived_roles/business.yaml`'s
 * `business_*_of` derived roles and cross-checked against the docs/17 §2.1
 * table. This is a COSMETIC mirror for rendering, not an authorization
 * decision — the Cerbos PDP is the only place that decision is actually
 * made (docs/14). If this table and the policy repo ever disagree, the
 * policy repo wins; this file changes to match it, never the other way.
 *
 * | Zone       | relationship | view                                            | edit                          |
 * |------------|--------------|--------------------------------------------------|-------------------------------|
 * | campaigns  | advertiser   | owner, admin, marketer, analyst                  | owner, admin, marketer        |
 * | inventory  | supplier     | owner, admin, merchandiser, analyst              | owner, admin, merchandiser    |
 * | redemption | redeemer     | owner, admin                                     | owner, admin                  |
 * | reports    | —            | owner, admin, marketer, merchandiser, finance, analyst | (view only, no edit action)   |
 * | billing    | —            | owner, admin, finance                            | owner, finance                |
 * | team       | —            | owner, admin                                     | owner, admin                  |
 */
export const ZONE_ACCESS: Record<ConsoleZone, ZoneAccessRule> = {
  campaigns: {
    relationship: "advertiser",
    view: ["owner", "admin", "marketer", "analyst"],
    edit: ["owner", "admin", "marketer"],
  },
  inventory: {
    relationship: "supplier",
    view: ["owner", "admin", "merchandiser", "analyst"],
    edit: ["owner", "admin", "merchandiser"],
  },
  redemption: {
    relationship: "redeemer",
    view: ["owner", "admin"],
    edit: ["owner", "admin"],
  },
  reports: {
    relationship: null,
    view: ["owner", "admin", "marketer", "merchandiser", "finance", "analyst"],
    edit: [],
  },
  billing: {
    relationship: null,
    view: ["owner", "admin", "finance"],
    edit: ["owner", "finance"],
  },
  team: {
    relationship: null,
    view: ["owner", "admin"],
    edit: ["owner", "admin"],
  },
};

/** Whether `role` may open `zone` on a business holding `relationships`. */
export function canViewZone(
  zone: ConsoleZone,
  role: ConsoleRole,
  relationships: readonly BusinessRelationship[],
): boolean {
  const rule = ZONE_ACCESS[zone];
  if (rule.relationship && !relationships.includes(rule.relationship)) {
    return false;
  }
  return rule.view.includes(role);
}

/** Whether `role` may change something inside `zone` on a business holding `relationships`. Implies `canViewZone`. */
export function canEditZone(
  zone: ConsoleZone,
  role: ConsoleRole,
  relationships: readonly BusinessRelationship[],
): boolean {
  return canViewZone(zone, role, relationships) && ZONE_ACCESS[zone].edit.includes(role);
}

/** The zones `role` may open on a business holding `relationships`, in the fixed display order. */
export function getVisibleZones(
  role: ConsoleRole,
  relationships: readonly BusinessRelationship[],
): readonly ConsoleZone[] {
  return CONSOLE_ZONES.filter((zone) => canViewZone(zone, role, relationships));
}

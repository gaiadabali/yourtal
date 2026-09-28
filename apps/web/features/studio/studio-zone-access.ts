import type { BusinessRole as BusinessRelationship } from "@yourtal/contracts/business";
import type { BusinessTeamRole as StudioRole } from "@yourtal/contracts/business/team-role";

/**
 * Studio's six dashboard zones (docs/17-surfaces-and-roles.md §2). Every
 * zone renders honestly even when the API behind it is still mock-only —
 * see each zone's own `*-data.ts` for its `resolveStudioDataSource` seam.
 *
 * No "redemption"/"redemptions" zone here: F40 moved that screen to 8.2.g
 * (Phase 8, once the counter-device and voucher-engine APIs exist) — a
 * business holding the `redeemer` relationship simply has no Studio zone
 * of its own yet, rather than a placeholder tab that leads nowhere.
 */
export const STUDIO_ZONES = [
  "campaigns",
  "inventory",
  "reports",
  "billing",
  "team",
  "channel",
] as const;
export type StudioZone = (typeof STUDIO_ZONES)[number];

export const ZONE_LABELS: Record<StudioZone, string> = {
  campaigns: "Campaigns",
  inventory: "Inventory",
  reports: "Reports",
  billing: "Billing",
  team: "Team",
  channel: "Channel settings",
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
  view: readonly StudioRole[];
  /** Roles that may change something inside the zone (a subset of `view`). */
  edit: readonly StudioRole[];
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
 * | reports    | —            | owner, admin, marketer, merchandiser, finance, analyst | (view only, no edit action)   |
 * | billing    | —            | owner, admin, finance                            | owner, finance                |
 * | team       | —            | owner, admin                                     | owner, admin                  |
 */
export const ZONE_ACCESS: Record<StudioZone, ZoneAccessRule> = {
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
  // Channel settings (logo, cover, handle) is business-profile editing, not
  // a Cerbos resource of its own — same owner/admin-only shape as Team,
  // reusing that gate rather than inventing a new derived role for it.
  channel: {
    relationship: null,
    view: ["owner", "admin"],
    edit: ["owner", "admin"],
  },
};

/** Whether `role` may open `zone` on a business holding `relationships`. */
export function canViewZone(
  zone: StudioZone,
  role: StudioRole,
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
  zone: StudioZone,
  role: StudioRole,
  relationships: readonly BusinessRelationship[],
): boolean {
  return canViewZone(zone, role, relationships) && ZONE_ACCESS[zone].edit.includes(role);
}

/** The zones `role` may open on a business holding `relationships`, in the fixed display order. */
export function getVisibleZones(
  role: StudioRole,
  relationships: readonly BusinessRelationship[],
): readonly StudioZone[] {
  return STUDIO_ZONES.filter((zone) => canViewZone(zone, role, relationships));
}

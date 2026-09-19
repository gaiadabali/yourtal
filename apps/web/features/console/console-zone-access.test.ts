import { describe, expect, it } from "vitest";
import { canEditZone, canViewZone, getVisibleZones } from "./console-zone-access";

const ALL_RELATIONSHIPS = ["advertiser", "supplier", "redeemer"] as const;

describe("console-zone-access", () => {
  it("shows owner and admin every zone when the business holds all three relationships", () => {
    expect(getVisibleZones("owner", ALL_RELATIONSHIPS)).toEqual([
      "campaigns",
      "inventory",
      "redemption",
      "reports",
      "billing",
      "team",
    ]);
    expect(getVisibleZones("admin", ALL_RELATIONSHIPS)).toEqual([
      "campaigns",
      "inventory",
      "redemption",
      "reports",
      "billing",
      "team",
    ]);
  });

  it("hides a relationship-gated zone the business does not hold, matching docs/17 §2's 'shows only the ones they use'", () => {
    // advertiser + supplier, no redeemer — mirrors longNameBusinessFixture.
    const relationships = ["advertiser", "supplier"] as const;
    expect(getVisibleZones("owner", relationships)).toEqual([
      "campaigns",
      "inventory",
      "reports",
      "billing",
      "team",
    ]);
    expect(canViewZone("redemption", "owner", relationships)).toBe(false);
  });

  it("mirrors team_test.yaml: only owner and admin may even view Team", () => {
    expect(canViewZone("team", "owner", ALL_RELATIONSHIPS)).toBe(true);
    expect(canViewZone("team", "admin", ALL_RELATIONSHIPS)).toBe(true);
    for (const role of ["marketer", "merchandiser", "finance", "analyst"] as const) {
      expect(canViewZone("team", role, ALL_RELATIONSHIPS)).toBe(false);
    }
  });

  it("mirrors business_test.yaml: analyst views campaigns and inventory but edits neither", () => {
    expect(canViewZone("campaigns", "analyst", ALL_RELATIONSHIPS)).toBe(true);
    expect(canEditZone("campaigns", "analyst", ALL_RELATIONSHIPS)).toBe(false);
    expect(canViewZone("inventory", "analyst", ALL_RELATIONSHIPS)).toBe(true);
    expect(canEditZone("inventory", "analyst", ALL_RELATIONSHIPS)).toBe(false);
  });

  it("gives marketer campaigns edit but no inventory or redemption access at all", () => {
    expect(canEditZone("campaigns", "marketer", ALL_RELATIONSHIPS)).toBe(true);
    expect(canViewZone("inventory", "marketer", ALL_RELATIONSHIPS)).toBe(false);
    expect(canViewZone("redemption", "marketer", ALL_RELATIONSHIPS)).toBe(false);
  });

  it("gives finance billing edit and report view, nothing else", () => {
    expect(canEditZone("billing", "finance", ALL_RELATIONSHIPS)).toBe(true);
    expect(canViewZone("reports", "finance", ALL_RELATIONSHIPS)).toBe(true);
    expect(canViewZone("campaigns", "finance", ALL_RELATIONSHIPS)).toBe(false);
    expect(canViewZone("team", "finance", ALL_RELATIONSHIPS)).toBe(false);
  });

  it("reports has no edit action for anyone — view-only zone", () => {
    for (const role of [
      "owner",
      "admin",
      "marketer",
      "merchandiser",
      "finance",
      "analyst",
    ] as const) {
      expect(canEditZone("reports", role, ALL_RELATIONSHIPS)).toBe(false);
    }
  });
});

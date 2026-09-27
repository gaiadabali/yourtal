import { describe, expect, it } from "vitest";
import { buildStudioNavItems, isActiveZone } from "./studio-zone-items";

describe("buildStudioNavItems", () => {
  it("builds one nav item per visible zone, in order, with the right route", () => {
    const items = buildStudioNavItems(["campaigns", "team"]);
    expect(items).toEqual([
      { zone: "campaigns", href: "/studio/campaigns", label: "Campaigns" },
      { zone: "team", href: "/studio/team", label: "Team" },
    ]);
  });

  it("returns nothing for an empty zone list", () => {
    expect(buildStudioNavItems([])).toEqual([]);
  });
});

describe("isActiveZone", () => {
  it("matches only the exact path, never a prefix", () => {
    expect(isActiveZone("/studio/team", "/studio/team")).toBe(true);
    expect(isActiveZone("/studio", "/studio/team")).toBe(false);
    expect(isActiveZone("/studio/team/anything", "/studio/team")).toBe(false);
  });
});

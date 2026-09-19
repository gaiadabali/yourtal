import { describe, expect, it } from "vitest";
import { buildConsoleNavItems, isActiveZone } from "./console-zone-items";

describe("buildConsoleNavItems", () => {
  it("builds one nav item per visible zone, in order, with the right route", () => {
    const items = buildConsoleNavItems(["campaigns", "team"]);
    expect(items).toEqual([
      { zone: "campaigns", href: "/business/campaigns", label: "Campaigns" },
      { zone: "team", href: "/business/team", label: "Team" },
    ]);
  });

  it("returns nothing for an empty zone list", () => {
    expect(buildConsoleNavItems([])).toEqual([]);
  });
});

describe("isActiveZone", () => {
  it("matches only the exact path, never a prefix", () => {
    expect(isActiveZone("/business/team", "/business/team")).toBe(true);
    expect(isActiveZone("/business", "/business/team")).toBe(false);
    expect(isActiveZone("/business/team/anything", "/business/team")).toBe(false);
  });
});

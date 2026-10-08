import { describe, expect, it } from "vitest";
import { getStudioTranslator } from "./studio-i18n";
import { buildStudioNavItems, isActiveZone } from "./studio-zone-items";

const t = getStudioTranslator("en-AU");
const tId = getStudioTranslator("id-ID");

describe("buildStudioNavItems", () => {
  it("builds one nav item per visible zone, in order, with the right route", () => {
    const items = buildStudioNavItems(["campaigns", "team"], t);
    expect(items.map(({ zone, href, label }) => ({ zone, href, label }))).toEqual([
      { zone: "campaigns", href: "/studio/campaigns", label: "Campaigns" },
      { zone: "team", href: "/studio/team", label: "Team" },
    ]);
  });

  it("names the zones in Indonesian for an id-ID viewer", () => {
    const items = buildStudioNavItems(["campaigns", "inventory", "team"], tId);
    expect(items.map((item) => item.label)).toEqual(["Kampanye", "Inventaris", "Tim"]);
    expect(items.every((item) => item.blurb.length > 0)).toBe(true);
  });

  it("returns nothing for an empty zone list", () => {
    expect(buildStudioNavItems([], t)).toEqual([]);
  });
});

describe("isActiveZone", () => {
  it("matches only the exact path, never a prefix", () => {
    expect(isActiveZone("/studio/team", "/studio/team")).toBe(true);
    expect(isActiveZone("/studio", "/studio/team")).toBe(false);
    expect(isActiveZone("/studio/team/anything", "/studio/team")).toBe(false);
  });
});

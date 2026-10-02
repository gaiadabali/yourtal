import { describe, expect, it } from "vitest";
import { categoryPolicy } from "@yourtal/jurisdiction/content-category";
import { DEMO_BRANDS } from "./catalogue";
import { DEMO_PEOPLE } from "./accounts";

// 13.1.a's numbers, per region, so a catalogue edit cannot quietly drop below them.
describe.each(["AU", "ID"] as const)("the %s demo world", (region) => {
  const brands = DEMO_BRANDS.filter((b) => b.region === region);
  const campaigns = brands.flatMap((b) => b.campaigns);
  const listings = brands.flatMap((b) => b.listings);

  it("has six brands, one per category the task names", () => {
    expect(brands.map((b) => b.contentCategory).sort()).toEqual(
      ["electronics", "fashion", "fitness", "food-and-drink", "games", "toys"].sort(),
    );
  });

  it("has enough teen and parents campaigns, both kinds, and 45 s to 15 min", () => {
    expect(campaigns.filter((c) => c.audience === "teen").length).toBeGreaterThanOrEqual(8);
    expect(campaigns.filter((c) => c.audience === "parents").length).toBeGreaterThanOrEqual(4);
    const lengths = campaigns.map((c) => c.seconds);
    expect(Math.min(...lengths)).toBe(45);
    expect(Math.max(...lengths)).toBe(900);
    expect(lengths.some((s) => s <= 60) && lengths.some((s) => s > 60)).toBe(true);
  });

  it("gives every brand vouchers, with at least six teen listings", () => {
    expect(brands.every((b) => b.listings.length > 0)).toBe(true);
    expect(listings.filter((l) => l.audience === "teen").length).toBeGreaterThanOrEqual(6);
  });

  it("never puts a restricted category in front of a teen", () => {
    for (const brand of brands) {
      if (brand.campaigns.some((c) => c.audience === "teen")) {
        expect(categoryPolicy(region, brand.contentCategory)).toBe("allowed");
      }
    }
  });

  it("has a login for every role", () => {
    const people = DEMO_PEOPLE.filter((p) => p.region === region && p.staffRole === undefined);
    expect(
      people.some((p) => p.trustTier === 3 && p.teen !== true && p.businessRole === undefined),
    ).toBe(true);
    expect(people.some((p) => p.teen === true)).toBe(true);
    for (const role of ["owner", "marketer", "finance"]) {
      expect(people.some((p) => p.businessRole === role)).toBe(true);
    }
  });
});

it("has staff admin, moderator and finance logins", () => {
  const roles = DEMO_PEOPLE.map((p) => p.staffRole);
  for (const role of ["admin", "moderator", "finance"]) expect(roles).toContain(role);
});

it("gives staff the demo password and everyone else the review password (F95)", async () => {
  const { passwordFor } = await import("./api-client");
  const passwords = { password: "staff-secret", reviewPassword: "review-secret" };
  for (const person of DEMO_PEOPLE) {
    expect(passwordFor(person.email, passwords)).toBe(
      person.staffRole === undefined ? "review-secret" : "staff-secret",
    );
  }
  expect(passwordFor("adult.au@demo.yourtal.test", { password: "only" })).toBe("only");
});

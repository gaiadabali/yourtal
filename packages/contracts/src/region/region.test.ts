import { describe, expect, it } from "vitest";
import { REGION_CONFIG, regionSchema } from "./region";

describe("regionSchema", () => {
  it.each(["AU", "ID"] as const)("round-trips %s", (region) => {
    expect(regionSchema.parse(region)).toBe(region);
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "lowercase", input: "au" },
    { name: "a country not on the platform", input: "US" },
    { name: "empty string", input: "" },
    { name: "null", input: null },
    { name: "undefined", input: undefined },
    { name: "number", input: 1 },
    { name: "object", input: { region: "AU" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(regionSchema.safeParse(input).success).toBe(false);
  });
});

describe("REGION_CONFIG", () => {
  it("carries exactly the regions the schema allows", () => {
    expect(Object.keys(REGION_CONFIG).sort()).toEqual(["AU", "ID"]);
  });

  it("pairs AU with en-AU/AUD and ID with id-ID/IDR — the locked mapping (docs/15)", () => {
    expect(REGION_CONFIG.AU).toEqual({
      locale: "en-AU",
      currency: "AUD",
      countryName: "Australia",
    });
    expect(REGION_CONFIG.ID).toEqual({
      locale: "id-ID",
      currency: "IDR",
      countryName: "Indonesia",
    });
  });

  it("never pairs a region with the other region's locale or currency", () => {
    for (const region of regionSchema.options) {
      const config = REGION_CONFIG[region];
      if (region === "AU") {
        expect(config.locale).not.toBe("id-ID");
        expect(config.currency).not.toBe("IDR");
      } else {
        expect(config.locale).not.toBe("en-AU");
        expect(config.currency).not.toBe("AUD");
      }
    }
  });
});

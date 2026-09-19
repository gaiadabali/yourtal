import { describe, expect, it } from "vitest";
import { createBusinessSchema } from "./create-business.schema";

const valid = {
  legalName: "PT Kopi Kenangan Indonesia",
  displayName: "Kopi Kenangan",
  district: "Kemang",
  roles: ["advertiser"],
  logoUrl: null,
};

describe("createBusinessSchema", () => {
  it("round-trips a valid request", () => {
    expect(createBusinessSchema.parse(valid)).toMatchObject({ displayName: "Kopi Kenangan" });
  });

  it("defaults logoUrl to null when omitted", () => {
    const { logoUrl: _logoUrl, ...withoutLogo } = valid;
    expect(createBusinessSchema.parse(withoutLogo).logoUrl).toBeNull();
  });

  it("round-trips multiple, non-duplicate roles", () => {
    expect(
      createBusinessSchema.safeParse({ ...valid, roles: ["advertiser", "redeemer"] }).success,
    ).toBe(true);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "empty legalName", overrides: { legalName: "" } },
    { name: "empty displayName", overrides: { displayName: "" } },
    { name: "empty district", overrides: { district: "" } },
    { name: "empty roles array", overrides: { roles: [] } },
    { name: "duplicate roles", overrides: { roles: ["advertiser", "advertiser"] } },
    { name: "invalid role enum value", overrides: { roles: ["owner"] } },
    { name: "non-url logoUrl", overrides: { logoUrl: "not-a-url" } },
    { name: "legalName over the length limit", overrides: { legalName: "a".repeat(161) } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(createBusinessSchema.safeParse(candidate).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createBusinessSchema } from "./create-business.schema";

const valid = {
  legalName: "PT Kopi Kenangan Indonesia",
  displayName: "Kopi Kenangan",
  taxIdKind: "NPWP",
  taxIdValue: "1234567890123456",
  addressState: null,
  addressPostcode: null,
  addressCity: "Jakarta",
  roles: ["advertiser"],
  logoUrl: null,
  region: "ID",
  handle: "kopi-kenangan",
  coverUrl: null,
};

const validAu = {
  legalName: "Wharf Espresso Pty Ltd",
  displayName: "Wharf Espresso",
  taxIdKind: "ABN",
  taxIdValue: "12345678901",
  addressState: "NSW",
  addressPostcode: "2000",
  addressCity: null,
  roles: ["advertiser"],
  logoUrl: null,
  region: "AU",
  handle: "wharf-espresso",
  coverUrl: null,
};

describe("createBusinessSchema", () => {
  it("round-trips a valid ID request", () => {
    expect(createBusinessSchema.parse(valid)).toMatchObject({ displayName: "Kopi Kenangan" });
  });

  it("round-trips a valid AU request", () => {
    expect(createBusinessSchema.parse(validAu)).toMatchObject({ displayName: "Wharf Espresso" });
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
    { name: "empty roles array", overrides: { roles: [] } },
    { name: "duplicate roles", overrides: { roles: ["advertiser", "advertiser"] } },
    { name: "invalid role enum value", overrides: { roles: ["owner"] } },
    { name: "non-url logoUrl", overrides: { logoUrl: "not-a-url" } },
    { name: "legalName over the length limit", overrides: { legalName: "a".repeat(161) } },
    { name: "invalid region enum value", overrides: { region: "US" } },
    { name: "uppercase handle", overrides: { handle: "Kopi-Kenangan" } },
    { name: "handle too short", overrides: { handle: "ab" } },
    { name: "ABN tax id on an ID business", overrides: { taxIdKind: "ABN" } },
    { name: "ID business missing addressCity", overrides: { addressCity: null } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(createBusinessSchema.safeParse(candidate).success).toBe(false);
  });

  const rejectionTableAu: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "NPWP tax id on an AU business", overrides: { taxIdKind: "NPWP" } },
    { name: "AU business missing addressState", overrides: { addressState: null } },
    { name: "AU business missing addressPostcode", overrides: { addressPostcode: null } },
    {
      name: "AU business carrying addressCity too",
      overrides: { addressCity: "Sydney" },
    },
  ];

  it.each(rejectionTableAu)("rejects $name (AU)", ({ overrides }) => {
    const candidate = { ...validAu, ...overrides };
    expect(createBusinessSchema.safeParse(candidate).success).toBe(false);
  });
});

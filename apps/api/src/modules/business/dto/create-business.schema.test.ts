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
  taxIdValue: "51824753556", // the ATO's own example ABN
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

  it("6.10.b: refuses an ABN that fails the check digit, with the en-AU message, on taxIdValue", () => {
    for (const taxIdValue of ["51824753557", "12345678901", "00000000000"]) {
      const result = createBusinessSchema.safeParse({ ...validAu, taxIdValue });
      expect(result.success, taxIdValue).toBe(false);
      const issue = result.error?.issues.find((i) => i.path[0] === "taxIdValue");
      expect(issue?.message).toBe(
        "That ABN doesn't look right. Check the 11 digits on your ABN record.",
      );
    }
  });

  it("6.10.b: accepts the ATO example typed with spaces, and leaves NPWP/NIB unchecked", () => {
    expect(
      createBusinessSchema.safeParse({ ...validAu, taxIdValue: "51 824 753 556" }).success,
    ).toBe(true);
    expect(
      createBusinessSchema.safeParse({ ...valid, taxIdValue: "1234567890123456" }).success,
    ).toBe(true);
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

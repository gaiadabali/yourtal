import { describe, expect, it } from "vitest";
import { businessSchema } from "./business";
import {
  generateBusiness,
  generateBusinesses,
  longNameBusinessFixture,
  mockBusinesses,
} from "./business.mock";

const validBusiness = {
  id: "11111111-1111-4111-8111-111111111111",
  legalName: "PT Kopi Kenangan Indonesia",
  displayName: "Kopi Kenangan",
  district: "Kemang",
  roles: ["advertiser", "supplier"],
  isVerified: true,
  logoUrl: "https://example.com/logo.png",
  region: "ID",
  currency: "IDR",
  handle: "kopi-kenangan",
  coverUrl: "https://example.com/cover.png",
};

describe("businessSchema", () => {
  it("round-trips a valid business", () => {
    const parsed = businessSchema.parse(validBusiness);
    expect(parsed).toMatchObject({
      displayName: "Kopi Kenangan",
      roles: ["advertiser", "supplier"],
    });
  });

  it("round-trips a business with a null logo", () => {
    expect(businessSchema.safeParse({ ...validBusiness, logoUrl: null }).success).toBe(true);
  });

  it("round-trips an AU business whose currency matches its region", () => {
    expect(
      businessSchema.safeParse({
        ...validBusiness,
        region: "AU",
        currency: "AUD",
        handle: "wharf-espresso",
      }).success,
    ).toBe(true);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "empty roles array", overrides: { roles: [] } },
    { name: "invalid role enum value", overrides: { roles: ["owner"] } },
    { name: "duplicate roles", overrides: { roles: ["advertiser", "advertiser"] } },
    { name: "empty legal name", overrides: { legalName: "" } },
    { name: "empty display name", overrides: { displayName: "" } },
    { name: "empty district", overrides: { district: "" } },
    { name: "non-boolean isVerified", overrides: { isVerified: "yes" } },
    { name: "non-url logoUrl", overrides: { logoUrl: "not-a-url" } },
    { name: "non-uuid id", overrides: { id: "not-a-uuid" } },
    { name: "roles not an array", overrides: { roles: "advertiser" } },
    { name: "invalid region enum value", overrides: { region: "US" } },
    {
      name: "currency crossing region (F2: regions never cross)",
      overrides: { region: "AU", currency: "IDR" },
    },
    { name: "uppercase handle", overrides: { handle: "Kopi-Kenangan" } },
    { name: "handle with an underscore", overrides: { handle: "kopi_kenangan" } },
    { name: "handle too short", overrides: { handle: "ab" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validBusiness, ...overrides };
    expect(businessSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateBusiness determinism", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generateBusiness({ seed: 3 });
    const second = generateBusiness({ seed: 3 });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateBusinesses(12, 4_000)).toStrictEqual(mockBusinesses);
  });
});

describe("awkward fixtures", () => {
  it("the long-name business fixture exceeds 40 characters in its display name", () => {
    expect(longNameBusinessFixture.displayName.length).toBeGreaterThan(40);
  });
});

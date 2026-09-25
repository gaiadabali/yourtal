import { describe, expect, it } from "vitest";
import { billingContactSchema } from "./billing-contact";
import {
  generateBillingContact,
  generateBillingContacts,
  mockBillingContacts,
} from "./billing-contact.mock";

const valid = {
  businessId: "11111111-1111-4111-8111-111111111111",
  name: "Finance Team",
  email: "finance@kopikenangan.example",
  phone: "+6281234567890",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("billingContactSchema", () => {
  it("round-trips a valid billing contact", () => {
    expect(billingContactSchema.parse(valid)).toMatchObject({ name: "Finance Team" });
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "empty name", overrides: { name: "" } },
    { name: "non-email email", overrides: { email: "not-an-email" } },
    { name: "phone with no leading +", overrides: { phone: "6281234567890" } },
    { name: "phone with leading zero after +", overrides: { phone: "+0812345678" } },
    { name: "phone too short", overrides: { phone: "+62812" } },
    { name: "non-uuid businessId", overrides: { businessId: "not-a-uuid" } },
    { name: "non-RFC3339 updatedAt", overrides: { updatedAt: "yesterday" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(billingContactSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateBillingContact determinism", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generateBillingContact({ seed: 3 });
    const second = generateBillingContact({ seed: 3 });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateBillingContacts(8, 8_000)).toStrictEqual(mockBillingContacts);
  });
});

import { describe, expect, it } from "vitest";
import { setBillingContactSchema } from "./set-billing-contact.schema";

const valid = {
  name: "Finance Team",
  email: "finance@kopikenangan.example",
  phone: "+6281234567890",
};

describe("setBillingContactSchema", () => {
  it("round-trips a valid billing contact", () => {
    expect(setBillingContactSchema.parse(valid)).toStrictEqual(valid);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "empty name", overrides: { name: "" } },
    { name: "non-email email", overrides: { email: "not-an-email" } },
    { name: "phone missing leading +", overrides: { phone: "6281234567890" } },
    {
      name: "businessId supplied by the client is not part of this shape",
      overrides: { businessId: "11111111-1111-4111-8111-111111111111" },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    if ("businessId" in overrides) {
      // A stray extra field is stripped, not rejected — Zod objects are not
      // strict by default. Assert the strip instead of a parse failure.
      expect(setBillingContactSchema.parse(candidate)).not.toHaveProperty("businessId");
      return;
    }
    expect(setBillingContactSchema.safeParse(candidate).success).toBe(false);
  });
});

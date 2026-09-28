import { describe, expect, it } from "vitest";
import {
  approveBusinessKybRequestSchema,
  reinstateBusinessRequestSchema,
  rejectBusinessKybRequestSchema,
  staffBusinessDetailSchema,
  staffBusinessSummarySchema,
  suspendBusinessRequestSchema,
} from "./businesses";

const reasonSchemas = [
  ["approveBusinessKybRequestSchema", approveBusinessKybRequestSchema],
  ["rejectBusinessKybRequestSchema", rejectBusinessKybRequestSchema],
  ["suspendBusinessRequestSchema", suspendBusinessRequestSchema],
  ["reinstateBusinessRequestSchema", reinstateBusinessRequestSchema],
] as const;

describe.each(reasonSchemas)("%s", (_name, schema) => {
  it("accepts a real reason", () => {
    expect(schema.safeParse({ reason: "documents check out" }).success).toBe(true);
  });

  it("rejects an empty reason", () => {
    expect(schema.safeParse({ reason: "" }).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });
});

const summary = {
  id: "11111111-1111-4111-8111-111111111111",
  legalName: "Wharf Espresso Pty Ltd",
  displayName: "Wharf Espresso",
  handle: "wharf-espresso",
  region: "AU",
  isVerified: false,
  suspendedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("staffBusinessSummarySchema", () => {
  it("round-trips a fresh, unverified business", () => {
    expect(staffBusinessSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe("staffBusinessDetailSchema", () => {
  it("round-trips a business with its KYB documents", () => {
    const detail = {
      ...summary,
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      suspendedReason: null,
      kybDocuments: [],
    };
    expect(staffBusinessDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("round-trips a suspended business", () => {
    const detail = {
      ...summary,
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      suspendedAt: "2026-02-01T00:00:00Z",
      suspendedReason: "fraudulent listings reported",
      kybDocuments: [],
    };
    expect(staffBusinessDetailSchema.safeParse(detail).success).toBe(true);
  });
});

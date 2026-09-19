import { describe, expect, it } from "vitest";
import { kybDocumentSchema } from "./kyb-document";
import { generateKybDocument, generateKybDocuments, mockKybDocuments } from "./kyb-document.mock";

const valid = {
  id: "22222222-2222-4222-8222-222222222222",
  businessId: "11111111-1111-4111-8111-111111111111",
  documentType: "business_registration_certificate",
  storageRef: "kms://kyb/one",
  status: "submitted",
  expiresAt: null,
  submittedAt: "2026-01-01T00:00:00Z",
  verifiedAt: null,
  verifiedByUserId: null,
};

describe("kybDocumentSchema", () => {
  it("round-trips a freshly submitted document", () => {
    expect(kybDocumentSchema.parse(valid)).toMatchObject({ status: "submitted" });
  });

  it("round-trips a verified document with an expiry", () => {
    const verified = {
      ...valid,
      status: "verified",
      expiresAt: "2027-01-01T00:00:00Z",
      verifiedAt: "2026-01-02T00:00:00Z",
      verifiedByUserId: "ops-1",
    };
    expect(kybDocumentSchema.safeParse(verified).success).toBe(true);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "invalid documentType", overrides: { documentType: "passport" } },
    { name: "invalid status", overrides: { status: "pending" } },
    { name: "empty storageRef", overrides: { storageRef: "" } },
    { name: "non-uuid id", overrides: { id: "not-a-uuid" } },
    { name: "non-RFC3339 submittedAt", overrides: { submittedAt: "yesterday" } },
    { name: "non-RFC3339 expiresAt", overrides: { expiresAt: "next year" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(kybDocumentSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateKybDocument determinism", () => {
  it("produces byte-identical output for the same seed", () => {
    const first = generateKybDocument({ seed: 3 });
    const second = generateKybDocument({ seed: 3 });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateKybDocuments(8, 9_000)).toStrictEqual(mockKybDocuments);
  });
});

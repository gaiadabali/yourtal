import { describe, expect, it } from "vitest";
import { submitKybDocumentSchema } from "./submit-kyb-document.schema";

const valid = {
  documentType: "tax_registration_number",
  storageRef: "kms://kyb/npwp",
  expiresAt: null,
};

describe("submitKybDocumentSchema", () => {
  it("round-trips a valid submission", () => {
    expect(submitKybDocumentSchema.parse(valid)).toMatchObject({
      documentType: "tax_registration_number",
    });
  });

  it("defaults expiresAt to null when omitted", () => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = valid;
    expect(submitKybDocumentSchema.parse(withoutExpiry).expiresAt).toBeNull();
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "unknown documentType", overrides: { documentType: "passport" } },
    { name: "empty storageRef", overrides: { storageRef: "" } },
    { name: "non-RFC3339 expiresAt", overrides: { expiresAt: "next year" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...valid, ...overrides };
    expect(submitKybDocumentSchema.safeParse(candidate).success).toBe(false);
  });
});

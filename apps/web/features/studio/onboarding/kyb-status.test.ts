import { describe, expect, it } from "vitest";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import { canUploadKyb, kybRows } from "./kyb-status";

function doc(
  documentType: KybDocument["documentType"],
  status: KybDocument["status"],
  submittedAt: string,
): KybDocument {
  return {
    id: crypto.randomUUID(),
    businessId: "00000000-0000-4000-8000-000000000601",
    documentType,
    storageRef: "kyb/x",
    status,
    expiresAt: null,
    submittedAt,
    verifiedAt: null,
    verifiedByUserId: null,
  };
}

describe("kybRows", () => {
  it("lists all four document types, missing until uploaded", () => {
    const rows = kybRows([doc("proof_of_address", "submitted", "2026-11-25T01:00:00.000Z")]);
    expect(rows).toStrictEqual([
      { type: "business_registration_certificate", status: "missing" },
      { type: "tax_registration_number", status: "missing" },
      { type: "director_identity", status: "missing" },
      { type: "proof_of_address", status: "submitted" },
    ]);
  });

  it("takes the newest document of a type, so a re-upload after a rejection shows as waiting", () => {
    const rows = kybRows([
      doc("director_identity", "rejected", "2026-11-25T01:00:00.000Z"),
      doc("director_identity", "submitted", "2026-11-25T02:00:00.000Z"),
    ]);
    expect(rows.find((row) => row.type === "director_identity")?.status).toBe("submitted");
  });
});

describe("canUploadKyb", () => {
  it("allows replacing while pending but not once approved", () => {
    expect(canUploadKyb("missing")).toBe(true);
    expect(canUploadKyb("submitted")).toBe(true);
    expect(canUploadKyb("rejected")).toBe(true);
    expect(canUploadKyb("verified")).toBe(false);
  });
});

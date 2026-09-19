import { describe, expect, it } from "vitest";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { InMemoryKybDocumentRepository } from "../persistence/in-memory-kyb-document.repository";
import { createBusiness } from "./create-business.use-case";
import { listKybDocuments } from "./list-kyb-documents.use-case";
import { submitKybDocument } from "./submit-kyb-document.use-case";

async function setup() {
  const store = new InMemoryBusinessStore();
  const businesses = new InMemoryBusinessAccountRepository(store);
  const kybDocuments = new InMemoryKybDocumentRepository(store);
  const unitOfWork = new InMemoryBusinessOnboardingUnitOfWork(store);
  const created = await createBusiness(
    unitOfWork,
    {
      legalName: "PT Kopi Kenangan Indonesia",
      displayName: "Kopi Kenangan",
      district: "Kemang",
      roles: ["advertiser"],
      logoUrl: null,
    },
    "owner-1",
  );
  const businessId = created._unsafeUnwrap().business.id;
  return { businesses, kybDocuments, businessId };
}

describe("submitKybDocument", () => {
  it("records a submitted document with expiry tracked", async () => {
    const { businesses, kybDocuments, businessId } = await setup();

    const result = await submitKybDocument(businesses, kybDocuments, {
      businessId,
      documentType: "tax_registration_number",
      storageRef: "kms://kyb/npwp",
      expiresAt: "2027-01-01T00:00:00Z",
    });

    expect(result.isOk()).toBe(true);
    const document = result._unsafeUnwrap();
    expect(document).toMatchObject({ status: "submitted", expiresAt: "2027-01-01T00:00:00.000Z" });
  });

  it("rejects submitting a document for a business that does not exist", async () => {
    const { kybDocuments } = await setup();
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);

    const result = await submitKybDocument(businesses, kybDocuments, {
      businessId: "00000000-0000-4000-8000-000000000000",
      documentType: "proof_of_address",
      storageRef: "kms://kyb/address",
      expiresAt: null,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

describe("listKybDocuments", () => {
  it("lists every document submitted for the business", async () => {
    const { businesses, kybDocuments, businessId } = await setup();
    (
      await submitKybDocument(businesses, kybDocuments, {
        businessId,
        documentType: "business_registration_certificate",
        storageRef: "kms://kyb/nib",
        expiresAt: null,
      })
    )._unsafeUnwrap();

    const result = await listKybDocuments(businesses, kybDocuments, businessId);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });
});

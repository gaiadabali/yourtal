import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleKybDocumentRepository } from "../persistence/drizzle-kyb-document.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { listKybDocuments } from "./list-kyb-documents.use-case";
import { submitKybDocument } from "./submit-kyb-document.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-submit-kyb-document";

async function setup() {
  const db = testBusinessDb();
  const businesses = new DrizzleBusinessAccountRepository(db);
  const kybDocuments = new DrizzleKybDocumentRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  const created = await createBusiness(
    unitOfWork,
    {
      legalName: "PT Kopi Kenangan Indonesia",
      displayName: "Kopi Kenangan",
      district: "Kemang",
      roles: ["advertiser"],
      logoUrl: null,
      region: "ID" as const,
      currency: "IDR" as const,
      handle: "test-business-015",
      coverUrl: null,
    },
    OWNER_ID,
  );
  const businessId = created._unsafeUnwrap().business.id;
  return { businesses, kybDocuments, businessId };
}

/**
 * A clean start, not only a clean finish — scoped to this file's own
 * fixtures now, not the whole table. See `business-db.test-helper.ts`.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

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
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);

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

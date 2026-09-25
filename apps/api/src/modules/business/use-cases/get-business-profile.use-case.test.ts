import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBillingContactRepository } from "../persistence/drizzle-billing-contact.repository";
import { DrizzleKybDocumentRepository } from "../persistence/drizzle-kyb-document.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { getBusinessProfile } from "./get-business-profile.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";
import { submitKybDocument } from "./submit-kyb-document.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-get-business-profile";

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

describe("getBusinessProfile", () => {
  it("aggregates the business, its billing contact, and its counts", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const members = new DrizzleBusinessMemberRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);
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
      },
      OWNER_ID,
    );
    const businessId = created._unsafeUnwrap().business.id;
    (
      await setBillingContact(businesses, billingContacts, {
        businessId,
        name: "Finance Team",
        email: "finance@kopikenangan.example",
        phone: "+6281234567890",
      })
    )._unsafeUnwrap();
    (
      await submitKybDocument(businesses, kybDocuments, {
        businessId,
        documentType: "business_registration_certificate",
        storageRef: "kms://kyb/one",
        expiresAt: null,
      })
    )._unsafeUnwrap();

    const result = await getBusinessProfile(
      businesses,
      members,
      billingContacts,
      kybDocuments,
      businessId,
    );

    expect(result.isOk()).toBe(true);
    const profile = result._unsafeUnwrap();
    expect(profile.business.displayName).toBe("Kopi Kenangan");
    expect(profile.billingContact?.email).toBe("finance@kopikenangan.example");
    expect(profile.kybDocumentCount).toBe(1);
    expect(profile.memberCount).toBe(1);
  });

  it("rejects a profile lookup for a business that does not exist", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const members = new DrizzleBusinessMemberRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);
    const kybDocuments = new DrizzleKybDocumentRepository(db);

    const result = await getBusinessProfile(
      businesses,
      members,
      billingContacts,
      kybDocuments,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

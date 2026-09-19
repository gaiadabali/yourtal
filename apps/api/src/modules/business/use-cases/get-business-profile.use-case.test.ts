import { describe, expect, it, beforeAll } from "vitest";
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
 * A clean start, not only a clean finish.
 *
 * These tests share one database (the package runs serially for that
 * reason). A run that fails part-way leaves its rows behind, and the next
 * one then trips a unique index and fails for a reason unrelated to what it
 * tests — burying a real failure under a fake one. Clearing before is what
 * makes the suite repeatable; clearing after only helps when the previous
 * run got that far.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb());
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
      "owner-1",
    );
    const businessId = created._unsafeUnwrap().business.id;
    (
      await setBillingContact(businesses, billingContacts, {
        businessId,
        name: "Finance Team",
        email: "finance@kopikenangan.id",
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
    expect(profile.billingContact?.email).toBe("finance@kopikenangan.id");
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

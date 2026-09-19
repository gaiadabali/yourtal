import { describe, expect, it, beforeAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBillingContactRepository } from "../persistence/drizzle-billing-contact.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { getBillingContact } from "./get-billing-contact.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";

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

describe("getBillingContact", () => {
  it("returns null when no contact has been set yet", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);
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

    const result = await getBillingContact(businesses, billingContacts, businessId);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("returns the contact once one has been set", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);
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
        name: "Finance",
        email: "finance@kopikenangan.id",
        phone: "+6281234567890",
      })
    )._unsafeUnwrap();

    const result = await getBillingContact(businesses, billingContacts, businessId);

    expect(result._unsafeUnwrap()).toMatchObject({ name: "Finance" });
  });

  it("rejects a lookup for a business that does not exist", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);

    const result = await getBillingContact(
      businesses,
      billingContacts,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

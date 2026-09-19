import { describe, expect, it, beforeAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBillingContactRepository } from "../persistence/drizzle-billing-contact.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
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

describe("setBillingContact", () => {
  it("upserts the contact, replacing a previous one", async () => {
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
        name: "First",
        email: "first@kopikenangan.id",
        phone: "+6281234567890",
      })
    )._unsafeUnwrap();
    const second = await setBillingContact(businesses, billingContacts, {
      businessId,
      name: "Second",
      email: "second@kopikenangan.id",
      phone: "+6281234567891",
    });

    expect(second.isOk()).toBe(true);
    expect(second._unsafeUnwrap().name).toBe("Second");
    expect(await billingContacts.findByBusiness(businessId)).toMatchObject({ name: "Second" });
  });

  it("rejects setting a billing contact for a business that does not exist", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const billingContacts = new DrizzleBillingContactRepository(db);

    const result = await setBillingContact(businesses, billingContacts, {
      businessId: "00000000-0000-4000-8000-000000000000",
      name: "Ghost",
      email: "ghost@example.com",
      phone: "+6281234567890",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

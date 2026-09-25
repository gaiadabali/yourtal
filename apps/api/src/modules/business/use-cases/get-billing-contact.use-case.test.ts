import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBillingContactRepository } from "../persistence/drizzle-billing-contact.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { getBillingContact } from "./get-billing-contact.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-get-billing-contact";

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
        region: "ID" as const,
        currency: "IDR" as const,
        handle: "test-business-008",
        coverUrl: null,
      },
      OWNER_ID,
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
        region: "ID" as const,
        currency: "IDR" as const,
        handle: "test-business-009",
        coverUrl: null,
      },
      OWNER_ID,
    );
    const businessId = created._unsafeUnwrap().business.id;
    (
      await setBillingContact(businesses, billingContacts, {
        businessId,
        name: "Finance",
        email: "finance@kopikenangan.example",
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

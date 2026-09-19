import { describe, expect, it } from "vitest";
import { InMemoryBillingContactRepository } from "../persistence/in-memory-billing-contact.repository";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";
import { getBillingContact } from "./get-billing-contact.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";

describe("getBillingContact", () => {
  it("returns null when no contact has been set yet", async () => {
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);
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

    const result = await getBillingContact(businesses, billingContacts, businessId);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("returns the contact once one has been set", async () => {
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);
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
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);

    const result = await getBillingContact(
      businesses,
      billingContacts,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

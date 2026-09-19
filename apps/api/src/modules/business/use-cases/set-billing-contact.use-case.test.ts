import { describe, expect, it } from "vitest";
import { InMemoryBillingContactRepository } from "../persistence/in-memory-billing-contact.repository";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";

describe("setBillingContact", () => {
  it("upserts the contact, replacing a previous one", async () => {
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
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);

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

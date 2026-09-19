import { describe, expect, it } from "vitest";
import { InMemoryBillingContactRepository } from "../persistence/in-memory-billing-contact.repository";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "../persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { InMemoryKybDocumentRepository } from "../persistence/in-memory-kyb-document.repository";
import { createBusiness } from "./create-business.use-case";
import { getBusinessProfile } from "./get-business-profile.use-case";
import { setBillingContact } from "./set-billing-contact.use-case";
import { submitKybDocument } from "./submit-kyb-document.use-case";

describe("getBusinessProfile", () => {
  it("aggregates the business, its billing contact, and its counts", async () => {
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const members = new InMemoryBusinessMemberRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);
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
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const members = new InMemoryBusinessMemberRepository(store);
    const billingContacts = new InMemoryBillingContactRepository(store);
    const kybDocuments = new InMemoryKybDocumentRepository(store);

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

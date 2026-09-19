import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type {
  BillingContactRepository,
  SetBillingContactInput,
} from "./billing-contact.repository";
import type { InMemoryBusinessStore } from "./in-memory-business-store";

export class InMemoryBillingContactRepository implements BillingContactRepository {
  constructor(private readonly store: InMemoryBusinessStore) {}

  upsert(input: SetBillingContactInput): Promise<BillingContact> {
    const contact: BillingContact = {
      businessId: input.businessId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      updatedAt: new Date().toISOString(),
    };
    this.store.billingContacts.set(input.businessId, contact);
    return Promise.resolve(contact);
  }

  findByBusiness(businessId: string): Promise<BillingContact | null> {
    return Promise.resolve(this.store.billingContacts.get(businessId) ?? null);
  }
}

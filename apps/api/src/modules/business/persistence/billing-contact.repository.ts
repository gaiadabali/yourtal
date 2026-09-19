import type { BillingContact } from "@yourtal/contracts/business/billing-contact";

export interface SetBillingContactInput {
  readonly businessId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

export interface BillingContactRepository {
  upsert(input: SetBillingContactInput): Promise<BillingContact>;
  findByBusiness(businessId: string): Promise<BillingContact | null>;
}

export const BILLING_CONTACT_REPOSITORY = Symbol("BILLING_CONTACT_REPOSITORY");

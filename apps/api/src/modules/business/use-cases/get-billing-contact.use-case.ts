import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { GetBusinessProfileError } from "../business.errors";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type { BillingContactRepository } from "../persistence/billing-contact.repository";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import { wrapPersistence } from "../wrap-persistence";

export function getBillingContact(
  businesses: BusinessAccountRepository,
  billingContacts: BillingContactRepository,
  businessId: string,
): ResultAsync<BillingContact | null, GetBusinessProfileError> {
  return wrapPersistence(businesses.findById(businessId)).andThen((business) =>
    business === null
      ? errAsync<BillingContact | null, GetBusinessProfileError>({
          type: "business_not_found",
          businessId,
        })
      : wrapPersistence(billingContacts.findByBusiness(businessId)),
  );
}

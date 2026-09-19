import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { SetBillingContactError } from "../business.errors";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type {
  BillingContactRepository,
  SetBillingContactInput,
} from "../persistence/billing-contact.repository";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import { wrapPersistence } from "../wrap-persistence";

export function setBillingContact(
  businesses: BusinessAccountRepository,
  billingContacts: BillingContactRepository,
  input: SetBillingContactInput,
): ResultAsync<BillingContact, SetBillingContactError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) =>
    business === null
      ? errAsync<BillingContact, SetBillingContactError>({
          type: "business_not_found",
          businessId: input.businessId,
        })
      : wrapPersistence(billingContacts.upsert(input)),
  );
}

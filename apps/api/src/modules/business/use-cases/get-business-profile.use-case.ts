import { errAsync, ResultAsync } from "neverthrow";
import type { Business } from "@yourtal/contracts/business";
import type { GetBusinessProfileError } from "../business.errors";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type { BillingContactRepository } from "../persistence/billing-contact.repository";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { BusinessMemberRepository } from "../persistence/business-member.repository";
import type { KybDocumentRepository } from "../persistence/kyb-document.repository";
import { wrapPersistence } from "../wrap-persistence";

export interface BusinessProfile {
  readonly business: Business;
  readonly billingContact: BillingContact | null;
  readonly kybDocumentCount: number;
  readonly memberCount: number;
}

export function getBusinessProfile(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  billingContacts: BillingContactRepository,
  kybDocuments: KybDocumentRepository,
  businessId: string,
): ResultAsync<BusinessProfile, GetBusinessProfileError> {
  return wrapPersistence(businesses.findById(businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<BusinessProfile, GetBusinessProfileError>({
        type: "business_not_found",
        businessId,
      });
    }
    return ResultAsync.combine([
      wrapPersistence(billingContacts.findByBusiness(businessId)),
      wrapPersistence(kybDocuments.listByBusiness(businessId)),
      wrapPersistence(members.listByBusiness(businessId)),
    ]).map(([billingContact, kyb, memberList]) => ({
      business,
      billingContact,
      kybDocumentCount: kyb.length,
      memberCount: memberList.length,
    }));
  });
}

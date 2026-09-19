import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { ListTeamError } from "../business.errors";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { BusinessMemberRepository } from "../persistence/business-member.repository";
import { wrapPersistence } from "../wrap-persistence";

export function listTeam(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  businessId: string,
): ResultAsync<BusinessMember[], ListTeamError> {
  return wrapPersistence(businesses.findById(businessId)).andThen((business) =>
    business === null
      ? errAsync<BusinessMember[], ListTeamError>({ type: "business_not_found", businessId })
      : wrapPersistence(members.listByBusiness(businessId)),
  );
}

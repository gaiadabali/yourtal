import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { TransferOwnershipError } from "../business.errors";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { TransferOwnershipUnitOfWork } from "../persistence/transfer-ownership.unit-of-work";
import { wrapPersistence } from "../wrap-persistence";

export interface TransferOwnershipInput {
  readonly businessId: string;
  readonly currentOwnerUserId: string;
  readonly newOwnerUserId: string;
}

export interface TransferOwnershipResult {
  readonly previousOwner: BusinessMember;
  readonly newOwner: BusinessMember;
}

/**
 * docs/17 section 2.1: "exactly one Owner", transferable only by the
 * current owner (`team.yaml`'s `only-the-owner-transfers-or-deletes` +
 * `ownership-transfer-needs-fresh-reauth` already gate WHO may call this;
 * this use-case only has to keep the invariant true, which the unit of
 * work's own comment covers).
 */
export function transferOwnership(
  businesses: BusinessAccountRepository,
  unitOfWork: TransferOwnershipUnitOfWork,
  input: TransferOwnershipInput,
): ResultAsync<TransferOwnershipResult, TransferOwnershipError> {
  return wrapPersistence(businesses.findById(input.businessId)).andThen((business) => {
    if (business === null) {
      return errAsync<TransferOwnershipResult, TransferOwnershipError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    return wrapPersistence(unitOfWork.transfer(input)).andThen((result) => {
      if (!result.ok) {
        return errAsync<TransferOwnershipResult, TransferOwnershipError>({
          type: "target_not_member",
          userId:
            result.reason === "new_owner_not_member"
              ? input.newOwnerUserId
              : input.currentOwnerUserId,
        });
      }
      return okAsync({ previousOwner: result.previousOwner, newOwner: result.newOwner });
    });
  });
}

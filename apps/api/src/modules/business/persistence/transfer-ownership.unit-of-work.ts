import type { BusinessMember } from "@yourtal/contracts/business/member";

export interface TransferOwnershipWrite {
  readonly businessId: string;
  readonly currentOwnerUserId: string;
  readonly newOwnerUserId: string;
}

export type TransferOwnershipWriteResult =
  | { readonly ok: true; readonly previousOwner: BusinessMember; readonly newOwner: BusinessMember }
  | { readonly ok: false; readonly reason: "current_owner_not_member" | "new_owner_not_member" };

/**
 * Demote-then-promote as ONE transaction (TASKS.md 7.1.c) — the same
 * "exist together or not at all" reasoning `BusinessOnboardingUnitOfWork`
 * documents. Two separate repository calls with no shared transaction
 * could leave a business with no owner at all between them if the process
 * died in between; `business_members_single_owner`'s partial unique index
 * is checked at the end of EACH statement, not deferred, which is exactly
 * why the order (demote first, freeing the slot, then promote) matters
 * within that one transaction.
 */
export interface TransferOwnershipUnitOfWork {
  transfer(input: TransferOwnershipWrite): Promise<TransferOwnershipWriteResult>;
}

export const TRANSFER_OWNERSHIP_UNIT_OF_WORK = Symbol("TRANSFER_OWNERSHIP_UNIT_OF_WORK");

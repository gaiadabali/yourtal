import type { BusinessMember } from "@yourtal/contracts/business/member";

/** `owner` is excluded on purpose: it moves only via `transfer_ownership`, never invite or change-role. */
export type GrantableRole = Exclude<BusinessMember["role"], "owner">;

export interface AddMemberInput {
  readonly businessId: string;
  readonly userId: string;
  readonly role: GrantableRole;
  readonly invitedByUserId: string;
}

export interface BusinessMemberRepository {
  addMember(input: AddMemberInput): Promise<BusinessMember>;
  findMember(businessId: string, userId: string): Promise<BusinessMember | null>;
  listByBusiness(businessId: string): Promise<BusinessMember[]>;
  updateRole(
    businessId: string,
    userId: string,
    role: GrantableRole,
  ): Promise<BusinessMember | null>;
  removeMember(businessId: string, userId: string): Promise<boolean>;
}

export const BUSINESS_MEMBER_REPOSITORY = Symbol("BUSINESS_MEMBER_REPOSITORY");

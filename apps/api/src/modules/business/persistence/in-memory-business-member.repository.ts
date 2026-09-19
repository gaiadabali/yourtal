import type { BusinessMember } from "@yourtal/contracts/business/member";
import type {
  AddMemberInput,
  BusinessMemberRepository,
  GrantableRole,
} from "./business-member.repository";
import { memberKey } from "./in-memory-business-store";
import type { InMemoryBusinessStore } from "./in-memory-business-store";

export class InMemoryBusinessMemberRepository implements BusinessMemberRepository {
  constructor(private readonly store: InMemoryBusinessStore) {}

  addMember(input: AddMemberInput): Promise<BusinessMember> {
    const member: BusinessMember = {
      businessId: input.businessId,
      userId: input.userId,
      role: input.role,
      invitedAt: new Date().toISOString(),
      invitedByUserId: input.invitedByUserId,
      joinedAt: null,
    };
    this.store.members.set(memberKey(input.businessId, input.userId), member);
    return Promise.resolve(member);
  }

  findMember(businessId: string, userId: string): Promise<BusinessMember | null> {
    return Promise.resolve(this.store.members.get(memberKey(businessId, userId)) ?? null);
  }

  listByBusiness(businessId: string): Promise<BusinessMember[]> {
    const members = [...this.store.members.values()].filter(
      (member) => member.businessId === businessId,
    );
    return Promise.resolve(members);
  }

  updateRole(
    businessId: string,
    userId: string,
    role: GrantableRole,
  ): Promise<BusinessMember | null> {
    const key = memberKey(businessId, userId);
    const existing = this.store.members.get(key);
    if (existing === undefined) {
      return Promise.resolve(null);
    }
    const updated: BusinessMember = { ...existing, role };
    this.store.members.set(key, updated);
    return Promise.resolve(updated);
  }

  removeMember(businessId: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.store.members.delete(memberKey(businessId, userId)));
  }
}

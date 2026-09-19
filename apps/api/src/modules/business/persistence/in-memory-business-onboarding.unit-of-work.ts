import { randomUUID } from "node:crypto";
import { businessSchema } from "@yourtal/contracts/business";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { CreateBusinessAccountInput } from "./business-account.repository";
import type {
  BusinessOnboardingUnitOfWork,
  CreateBusinessResult,
} from "./business-onboarding.unit-of-work";
import { memberKey } from "./in-memory-business-store";
import type { InMemoryBusinessStore } from "./in-memory-business-store";

export class InMemoryBusinessOnboardingUnitOfWork implements BusinessOnboardingUnitOfWork {
  constructor(private readonly store: InMemoryBusinessStore) {}

  createBusinessWithOwner(
    input: CreateBusinessAccountInput,
    ownerUserId: string,
  ): Promise<CreateBusinessResult> {
    const business = businessSchema.parse({
      id: randomUUID(),
      legalName: input.legalName,
      displayName: input.displayName,
      district: input.district,
      roles: input.roles,
      isVerified: false,
      logoUrl: input.logoUrl,
    });
    const now = new Date().toISOString();
    const owner: BusinessMember = {
      businessId: business.id,
      userId: ownerUserId,
      role: "owner",
      invitedAt: now,
      invitedByUserId: ownerUserId,
      joinedAt: now,
    };

    // Single-threaded and synchronous end to end, so this is atomic in the
    // only sense that matters for a fake: no partial state is observable.
    this.store.businesses.set(business.id, business);
    this.store.members.set(memberKey(business.id, ownerUserId), owner);

    return Promise.resolve({ business, owner });
  }
}

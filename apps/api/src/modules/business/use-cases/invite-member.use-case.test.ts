import { describe, expect, it } from "vitest";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "../persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

async function setupWithBusiness() {
  const store = new InMemoryBusinessStore();
  const businesses = new InMemoryBusinessAccountRepository(store);
  const members = new InMemoryBusinessMemberRepository(store);
  const unitOfWork = new InMemoryBusinessOnboardingUnitOfWork(store);
  const created = await createBusiness(
    unitOfWork,
    {
      legalName: "PT Kopi Kenangan Indonesia",
      displayName: "Kopi Kenangan",
      district: "Kemang",
      roles: ["advertiser"],
      logoUrl: null,
    },
    "owner-1",
  );
  const businessId = created._unsafeUnwrap().business.id;
  return { businesses, members, businessId };
}

describe("inviteMember", () => {
  it("adds a new member with the requested role, unjoined", async () => {
    const { businesses, members, businessId } = await setupWithBusiness();

    const result = await inviteMember(businesses, members, {
      businessId,
      userId: "marketer-1",
      role: "marketer",
      invitedByUserId: "owner-1",
    });

    expect(result.isOk()).toBe(true);
    const member = result._unsafeUnwrap();
    expect(member).toMatchObject({ userId: "marketer-1", role: "marketer", joinedAt: null });
  });

  it("rejects a second invite to the same person", async () => {
    const { businesses, members, businessId } = await setupWithBusiness();
    (
      await inviteMember(businesses, members, {
        businessId,
        userId: "marketer-1",
        role: "marketer",
        invitedByUserId: "owner-1",
      })
    )._unsafeUnwrap();

    const result = await inviteMember(businesses, members, {
      businessId,
      userId: "marketer-1",
      role: "analyst",
      invitedByUserId: "owner-1",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({
      type: "member_already_exists",
      userId: "marketer-1",
    });
  });

  it("rejects an invite against a business that does not exist", async () => {
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const members = new InMemoryBusinessMemberRepository(store);

    const result = await inviteMember(businesses, members, {
      businessId: "00000000-0000-4000-8000-000000000000",
      userId: "marketer-1",
      role: "marketer",
      invitedByUserId: "owner-1",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

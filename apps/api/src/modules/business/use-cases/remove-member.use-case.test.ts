import { describe, expect, it } from "vitest";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "../persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";
import { removeMember } from "./remove-member.use-case";

async function setup() {
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
  (
    await inviteMember(businesses, members, {
      businessId,
      userId: "member-1",
      role: "marketer",
      invitedByUserId: "owner-1",
    })
  )._unsafeUnwrap();
  return { businesses, members, businessId };
}

describe("removeMember", () => {
  it("removes an ordinary member", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: "member-1" });

    expect(result.isOk()).toBe(true);
    expect(await members.findMember(businessId, "member-1")).toBeNull();
  });

  it("refuses to remove the owner, even though the caller is not asked whether they are one", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: "owner-1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "cannot_remove_owner" });
    expect(await members.findMember(businessId, "owner-1")).not.toBeNull();
  });

  it("rejects removing a member that does not exist", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: "ghost" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "member_not_found", userId: "ghost" });
  });
});

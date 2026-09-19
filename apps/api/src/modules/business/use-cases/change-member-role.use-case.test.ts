import { describe, expect, it } from "vitest";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "../persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { changeMemberRole } from "./change-member-role.use-case";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

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

describe("changeMemberRole", () => {
  it("updates an existing member's role", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await changeMemberRole(businesses, members, {
      businessId,
      userId: "member-1",
      role: "analyst",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().role).toBe("analyst");
  });

  it("rejects a role change for a member who does not exist", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await changeMemberRole(businesses, members, {
      businessId,
      userId: "ghost",
      role: "analyst",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "member_not_found", userId: "ghost" });
  });
});

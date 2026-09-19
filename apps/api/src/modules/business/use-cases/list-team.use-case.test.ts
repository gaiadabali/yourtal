import { describe, expect, it } from "vitest";
import { InMemoryBusinessAccountRepository } from "../persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "../persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";
import { listTeam } from "./list-team.use-case";

describe("listTeam", () => {
  it("lists the owner plus any invited members", async () => {
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
        role: "finance",
        invitedByUserId: "owner-1",
      })
    )._unsafeUnwrap();

    const result = await listTeam(businesses, members, businessId);

    expect(result.isOk()).toBe(true);
    const team = result._unsafeUnwrap();
    expect(team).toHaveLength(2);
    expect(team.map((member) => member.userId).sort()).toStrictEqual(["member-1", "owner-1"]);
  });

  it("rejects listing the team of a business that does not exist", async () => {
    const store = new InMemoryBusinessStore();
    const businesses = new InMemoryBusinessAccountRepository(store);
    const members = new InMemoryBusinessMemberRepository(store);

    const result = await listTeam(businesses, members, "00000000-0000-4000-8000-000000000000");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

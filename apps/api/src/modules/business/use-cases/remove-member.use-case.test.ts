import { describe, expect, it, beforeAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";
import { removeMember } from "./remove-member.use-case";

async function setup() {
  const db = testBusinessDb();
  const businesses = new DrizzleBusinessAccountRepository(db);
  const members = new DrizzleBusinessMemberRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
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

/**
 * A clean start, not only a clean finish.
 *
 * These tests share one database (the package runs serially for that
 * reason). A run that fails part-way leaves its rows behind, and the next
 * one then trips a unique index and fails for a reason unrelated to what it
 * tests — burying a real failure under a fake one. Clearing before is what
 * makes the suite repeatable; clearing after only helps when the previous
 * run got that far.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb());
});

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

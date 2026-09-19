import { describe, expect, it, beforeAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

async function setupWithBusiness() {
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
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const members = new DrizzleBusinessMemberRepository(db);

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

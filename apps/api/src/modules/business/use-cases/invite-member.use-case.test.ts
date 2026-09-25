import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-invite-member";

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
    OWNER_ID,
  );
  const businessId = created._unsafeUnwrap().business.id;
  return { businesses, members, businessId };
}

/**
 * A clean start, not only a clean finish — scoped to this file's own
 * fixtures now, not the whole table. See `business-db.test-helper.ts`.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

describe("inviteMember", () => {
  it("adds a new member with the requested role, unjoined", async () => {
    const { businesses, members, businessId } = await setupWithBusiness();

    const result = await inviteMember(businesses, members, {
      businessId,
      userId: "marketer-1",
      role: "marketer",
      invitedByUserId: OWNER_ID,
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
        invitedByUserId: OWNER_ID,
      })
    )._unsafeUnwrap();

    const result = await inviteMember(businesses, members, {
      businessId,
      userId: "marketer-1",
      role: "analyst",
      invitedByUserId: OWNER_ID,
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
      invitedByUserId: OWNER_ID,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

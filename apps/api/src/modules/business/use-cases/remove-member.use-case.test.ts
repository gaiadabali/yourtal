import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";
import { removeMember } from "./remove-member.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-remove-member";

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
      region: "ID" as const,
      currency: "IDR" as const,
      handle: `test-business-${randomUUID().slice(0, 8)}`,
      coverUrl: null,
    },
    OWNER_ID,
  );
  const businessId = created._unsafeUnwrap().business.id;
  (
    await inviteMember(businesses, members, {
      businessId,
      userId: "member-1",
      role: "marketer",
      invitedByUserId: OWNER_ID,
    })
  )._unsafeUnwrap();
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

describe("removeMember", () => {
  it("removes an ordinary member", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: "member-1" });

    expect(result.isOk()).toBe(true);
    expect(await members.findMember(businessId, "member-1")).toBeNull();
  });

  it("refuses to remove the owner, even though the caller is not asked whether they are one", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: OWNER_ID });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "cannot_remove_owner" });
    expect(await members.findMember(businessId, OWNER_ID)).not.toBeNull();
  });

  it("rejects removing a member that does not exist", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await removeMember(businesses, members, { businessId, userId: "ghost" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "member_not_found", userId: "ghost" });
  });
});

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { changeMemberRole } from "./change-member-role.use-case";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings.
 * YT-0547's cross-file half: `clearBusinessTables` now scopes cleanup to
 * the businesses this tag owns, and two files tagging their fixtures
 * identically would be exactly as unsafe as the whole-table wipe it
 * replaces. See `business-db.test-helper.ts`.
 */
const OWNER_ID = "owner-change-member-role";

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
      handle: "test-business-005",
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

  it("refuses to change the owner's role, even though the caller is not asked whether they are one", async () => {
    const { businesses, members, businessId } = await setup();

    const result = await changeMemberRole(businesses, members, {
      businessId,
      userId: OWNER_ID,
      role: "admin",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "cannot_change_owner_role" });
    expect((await members.findMember(businessId, OWNER_ID))?.role).toBe("owner");
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

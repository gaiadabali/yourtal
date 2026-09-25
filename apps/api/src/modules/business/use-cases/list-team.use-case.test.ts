import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";
import { listTeam } from "./list-team.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-list-team";

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

describe("listTeam", () => {
  it("lists the owner plus any invited members", async () => {
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
        handle: "test-business-012",
        coverUrl: null,
      },
      OWNER_ID,
    );
    const businessId = created._unsafeUnwrap().business.id;
    (
      await inviteMember(businesses, members, {
        businessId,
        userId: "member-1",
        role: "finance",
        invitedByUserId: OWNER_ID,
      })
    )._unsafeUnwrap();

    const result = await listTeam(businesses, members, businessId);

    expect(result.isOk()).toBe(true);
    const team = result._unsafeUnwrap();
    expect(team).toHaveLength(2);
    expect(team.map((member) => member.userId).sort()).toStrictEqual(["member-1", OWNER_ID].sort());
  });

  it("rejects listing the team of a business that does not exist", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const members = new DrizzleBusinessMemberRepository(db);

    const result = await listTeam(businesses, members, "00000000-0000-4000-8000-000000000000");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});

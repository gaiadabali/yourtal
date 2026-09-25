import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessOnboardingUnitOfWork } from "./drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "./business-db.test-helper";
import { businessAccounts } from "./schema/business-account.table";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 *
 * The second test below's owner id (a real NUL byte, not typed here to
 * avoid corrupting it through this comment) never gets a chance to reach
 * `business_members` at all — that INSERT is the one the NUL byte fails,
 * which is the point of the test — so it never needs a cleanup scope of
 * its own.
 */
const COMMIT_OWNER_ID = "user-commit-witness";

/**
 * YT-0552's highest-risk claim, checked directly: does
 * `DrizzleBusinessOnboardingUnitOfWork.createBusinessWithOwner` really open
 * one Postgres transaction across both inserts, or does it just happen to
 * look atomic because nothing in the happy-path tests ever makes the second
 * insert fail?
 *
 * `create-business.use-case.test.ts` proves the commit path — a business
 * and its owner both land, and a `DrizzleBusinessAccountRepository` reads
 * the business back. It does not prove the rollback path: its "persistence
 * failure" test replaces the unit-of-work with a hand-written object whose
 * `createBusinessWithOwner` just rejects a Promise, so `db.transaction`
 * itself never runs. That is enough to test the use-case's error mapping,
 * and nothing about whether `tx.insert(...)` failing halfway actually
 * undoes the first insert.
 *
 * This suite makes the second insert fail for real. `business_accounts`
 * has no column derived from `ownerUserId`; `business_members` has two
 * (`user_id`, `invited_by_user_id`). A NUL byte is legal JS/TS string
 * content but Postgres text columns reject it outright ("null character
 * not permitted", confirmed by hand against this same container). Passing
 * one in `ownerUserId` therefore lets the `business_accounts` INSERT
 * succeed exactly as it would in production, then fails the
 * `business_members` INSERT inside the same transaction — the precise
 * shape docs/17 section 2.1 worries about ("a business and its founding
 * owner membership must exist together or not at all"). If Drizzle's
 * `db.transaction` were not really wrapping both statements in one
 * BEGIN/COMMIT/ROLLBACK, this test would find an orphaned business row.
 */

beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [COMMIT_OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [COMMIT_OWNER_ID]);
});

describe("DrizzleBusinessOnboardingUnitOfWork — real Postgres transaction", () => {
  it("commits both rows atomically on success", async () => {
    const db = testBusinessDb();
    const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);

    const result = await unitOfWork.createBusinessWithOwner(
      {
        legalName: "PT Rollback Witness Indonesia",
        displayName: "Rollback Witness",
        district: "Kemang",
        roles: ["advertiser"],
        logoUrl: null,
        region: "ID" as const,
        currency: "IDR" as const,
        handle: "test-business-001",
        coverUrl: null,
      },
      COMMIT_OWNER_ID,
    );

    const [row] = await db
      .select()
      .from(businessAccounts)
      .where(eq(businessAccounts.id, result.business.id));
    expect(row).toBeDefined();
    expect(row?.displayName).toBe("Rollback Witness");
  });

  it("rolls back the business_accounts insert when the business_members insert fails", async () => {
    const db = testBusinessDb();
    const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);

    const legalName = "PT Rollback Casualty Indonesia";

    await expect(
      unitOfWork.createBusinessWithOwner(
        {
          legalName,
          displayName: "Rollback Casualty",
          district: "Kemang",
          roles: ["advertiser"],
          logoUrl: null,
          region: "ID" as const,
          currency: "IDR" as const,
          handle: "test-business-002",
          coverUrl: null,
        },
        // The NUL byte only reaches business_members (user_id,
        // invited_by_user_id) — business_accounts has no column built
        // from ownerUserId, so its INSERT succeeds before the failure.
        "user-\u0000-poison",
      ),
    ).rejects.toThrow();

    // The witness: if the transaction were not atomic, this row would
    // exist even though createBusinessWithOwner threw.
    const [row] = await db
      .select()
      .from(businessAccounts)
      .where(eq(businessAccounts.legalName, legalName));
    expect(row).toBeUndefined();
  });
});

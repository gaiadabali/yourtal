import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { DrizzleUserProfileRepository } from "../../modules/identity/persistence/drizzle-user-profile.repository";
import { testDb } from "../testing/test-db";
import { withAgeBandEnrichment } from "./age-band-ledger-client";
import { FakeLedgerClient } from "./fake-ledger-client";

/**
 * 12.1.c: `withAgeBandEnrichment` is the ONE place a grant's `ageBand` is
 * derived — this proves it derives the REAL value from the user's own
 * profile DOB (never trusting a caller), refuses rather than defaults when
 * no profile exists, and that a teen wrapped this way is actually capped by
 * AU's real `teen_daily_earn_cap` (250, migration
 * 20260925193000_platform_region_setting.sql) while an adult is not.
 */
const db = testDb();
const profiles = new DrizzleUserProfileRepository(db);

async function seedProfile(userId: string, dateOfBirth: string): Promise<void> {
  await profiles.create({
    userId,
    region: "AU",
    displayLocale: "en-AU",
    displayName: "12.1.c ageband fixture",
    dateOfBirth,
    timezone: "Australia/Sydney",
    parentConsentStatus: "not_required",
  });
}

/** Marketing-funded grants (goodwill/receipt/streak) need AU cash behind them (10.7.a) — a generous, one-off top-up. */
async function fundAuMarketing(): Promise<void> {
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_marketing_fund (region, amount_minor, proposed_by, approved_by)
    VALUES ('AU', 1000000, 'staff-1', 'staff-2')
  `);
}

describe("withAgeBandEnrichment (12.1.c)", () => {
  it("derives ageBand from the user's own profile DOB and passes it through to the inner client", async () => {
    await fundAuMarketing();
    const client = withAgeBandEnrichment(new FakeLedgerClient(db), db);
    const adult = randomUUID();
    await seedProfile(adult, "1990-01-01");

    const granted = await client.grantAction({
      kind: "goodwill",
      userId: adult,
      region: "AU",
      points: toPoints(100),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(granted.isOk()).toBe(true);
  });

  it("refuses rather than defaults to adult when no profile row exists", async () => {
    await fundAuMarketing();
    const client = withAgeBandEnrichment(new FakeLedgerClient(db), db);
    const ghost = randomUUID(); // no seedProfile call for this id

    const result = await client.grantAction({
      kind: "goodwill",
      userId: ghost,
      region: "AU",
      points: toPoints(50),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("region_mismatch");
  });

  it("a teen crossing AU's real 250-point teen daily cap is refused; the identical sequence succeeds for an adult", async () => {
    await fundAuMarketing();
    const client = withAgeBandEnrichment(new FakeLedgerClient(db), db);

    const teen = randomUUID();
    await seedProfile(teen, "2013-06-01"); // a young teen throughout 2026
    for (let i = 0; i < 4; i++) {
      // 4 x 60 = 240, under the 250 teen cap
      const granted = await client.grantAction({
        kind: "receipt",
        userId: teen,
        region: "AU",
        points: toPoints(60),
        trustTier: 3,
        idempotencyKey: randomUUID(),
      });
      expect(granted.isOk()).toBe(true);
    }
    const refused = await client.grantAction({
      kind: "receipt",
      userId: teen,
      region: "AU",
      points: toPoints(60),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("velocity_capped");

    const adult = randomUUID();
    await seedProfile(adult, "1990-01-01");
    for (let i = 0; i < 5; i++) {
      // 5 x 60 = 300 — over the TEEN cap but comfortably under the 500 adult one
      const granted = await client.grantAction({
        kind: "receipt",
        userId: adult,
        region: "AU",
        points: toPoints(60),
        trustTier: 3,
        idempotencyKey: randomUUID(),
      });
      expect(granted.isOk()).toBe(true);
    }
  });
});

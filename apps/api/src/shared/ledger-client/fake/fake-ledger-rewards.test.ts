import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { testDb } from "../../testing/test-db";
import { grantAction } from "./fake-ledger-rewards";

/**
 * 10.7.a's exact bookkeeping: `ledger-client.contract.spec.ts` proves the
 * BEHAVIOUR (a grant beyond the fund is refused) is the same against the
 * fake and the live Go ledger, but it has no way to peek at "how much of
 * the fund is left" through the client interface alone — this suite does,
 * with a direct read of `platform.ledger_fake_marketing_backing`, the
 * fake-only debit table 10.7.a added.
 */
const db = testDb();

async function fundMarketing(region: "AU" | "ID", amountMinor: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_marketing_fund (region, amount_minor, proposed_by, approved_by)
    VALUES (${region}, ${amountMinor}, 'staff-1', 'staff-2')
  `);
}

async function backingTotal(region: "AU" | "ID"): Promise<number> {
  const rows = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(amount_minor), 0) AS total FROM platform.ledger_fake_marketing_backing
     WHERE region = ${region}
  `);
  return Number(rows.rows[0]?.total ?? 0);
}

/** The SAME rate grantAction itself reads — computed here, not hardcoded, because other suites in the same test run (proposeRate/approveRate) may have moved AU or ID's rate in force since the migration's own seed. */
async function currentBackingMicros(region: "AU" | "ID"): Promise<number> {
  const rows = await db.execute<{ backing_rate_micros_per_pt: string }>(sql`
    SELECT backing_rate_micros_per_pt FROM platform.ledger_fake_backing_rate
     WHERE region = ${region} ORDER BY effective_from DESC LIMIT 1
  `);
  const rate = rows.rows[0];
  if (rate === undefined)
    throw new Error(`no backing rate is in force for region ${region} — cannot run this test`);
  return Number(rate.backing_rate_micros_per_pt);
}

describe("grantAction debits the region's marketing fund by exactly its backing (10.7.a)", () => {
  it("posts ceil(points × B) to the backing table, once, and refuses past the remaining fund", async () => {
    const points = 300;
    const micros = await currentBackingMicros("AU");
    const expectedBacking = Math.ceil((points * micros) / 1_000_000);
    // A top-up comfortably larger than what this single grant needs.
    await fundMarketing("AU", expectedBacking + 1_000);

    const before = await backingTotal("AU");
    const idempotencyKey = randomUUID();
    const request = {
      kind: "goodwill" as const,
      userId: randomUUID(),
      region: "AU" as const,
      points: toPoints(points),
      trustTier: 3 as const,
      idempotencyKey,
    };

    const grant = await grantAction(db, request);
    expect(grant.isOk()).toBe(true);

    const after = await backingTotal("AU");
    expect(after - before).toBe(expectedBacking);

    // A replay of the SAME idempotency key must not debit a second time.
    const replay = await grantAction(db, request);
    expect(replay.isOk()).toBe(true);
    expect(await backingTotal("AU")).toBe(after);
  });

  it("refuses a grant whose backing exceeds the region's marketing fund, and posts no backing row for it", async () => {
    const region = "ID";
    const before = await backingTotal(region);

    // The MAX legal points value (10 billion, money.ts's own ceiling) at
    // ANY plausible backing rate needs billions of minor units — vastly
    // beyond anything this whole test run funds for ID anywhere (tens of
    // millions at most), so this is refused regardless of how much other
    // suites sharing this database have already funded or drawn down.
    const refused = await grantAction(db, {
      kind: "goodwill",
      userId: randomUUID(),
      region,
      points: toPoints(10_000_000_000),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(refused.isErr() && refused.error.code).toBe("insufficient_available");

    const after = await backingTotal(region);
    expect(after).toBe(before);
  });
});

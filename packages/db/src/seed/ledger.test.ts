import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { LEDGER_URL, OWNER_URL } from "../database-urls";
import { MARKETING_BUDGET, seedLedger } from "./ledger";

/**
 * 4.4.l: the seed funds marketing once, through the ledger's own rules.
 * with-test-db already seeded this database once; two more runs must leave
 * each region's marketing cash at exactly the budget.
 */
let owner: pg.Pool;
let ledger: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
  ledger = new pg.Pool({ connectionString: LEDGER_URL, max: 2 });
});

afterAll(async () => {
  await owner.end();
  await ledger.end();
});

async function marketingCash(region: string): Promise<number> {
  // An asset under the credit-positive convention: its balance is -SUM.
  const { rows } = await ledger.query<{ balance: string }>(
    `SELECT (-COALESCE(SUM(amount_minor), 0))::text AS balance
       FROM ledger.entry WHERE account_id = $1`,
    [`plat_${region}_marketing_cash`],
  );
  return Number(rows[0]?.balance);
}

describe("seedLedger", () => {
  it("funds each region's marketing budget exactly once", async () => {
    await seedLedger(owner);
    await seedLedger(owner);
    for (const { region, amountMinor } of MARKETING_BUDGET) {
      expect(await marketingCash(region)).toBe(amountMinor);
      const { rows } = await ledger.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM ledger.marketing_funding
          WHERE region = $1 AND proposed_by <> approved_by`,
        [region],
      );
      expect(rows[0]?.n).toBe("1");
    }
  });

  it("is written under the ledger's rules: marketing cash cannot rise without a funding row", async () => {
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE yourtal_ledger");
      await client.query(
        `INSERT INTO ledger.transfer (id, idempotency_key, reason_code)
         VALUES ('led_txn_unfunded_probe', 'unfunded_probe', 'fund_marketing')`,
      );
      await client.query(
        `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency) VALUES
           ('led_txn_unfunded_probe', 'plat_AU_marketing_cash', -1, 'AUD'),
           ('led_txn_unfunded_probe', 'plat_AU_platform_equity', 1, 'AUD')`,
      );
      await expect(client.query("COMMIT")).rejects.toThrow(/marketing cash increases only/);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

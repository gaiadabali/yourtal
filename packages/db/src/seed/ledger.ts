import type pg from "pg";

/**
 * Ledger's own domain. 4.4.l: the F12 marketing budget, so staging's
 * streaks and receipts have cash behind them (K6).
 *
 * The same posting `FundMarketing` makes (services/ledger/internal/reward/
 * marketing.go): Dr marketing_cash / Cr platform_equity, recorded in
 * `ledger.marketing_funding` with two different people. It is written AS
 * `yourtal_ledger` (`SET LOCAL ROLE`), so every ledger rule binds the seed as
 * it binds the service — sealing, currency, balance at commit, and the
 * trigger that lets marketing cash rise only with a funding row — rather than
 * the superuser exemption. The seed runs without the ledger service up, so it
 * cannot call the HTTP route; and the ids are fixed, so a re-run is a no-op.
 */

/** Minor units: AUD 5,000 and IDR 50,000,000 (F12). */
export const MARKETING_BUDGET = [
  { region: "AU", currency: "AUD", amountMinor: 500_000 },
  { region: "ID", currency: "IDR", amountMinor: 50_000_000 },
] as const;

const PROPOSED_BY = "seed:platform-owner";
const APPROVED_BY = "seed:platform-finance";

export async function seedLedger(pool: pg.Pool): Promise<void> {
  for (const budget of MARKETING_BUDGET) {
    await fundMarketing(pool, budget);
  }
}

async function fundMarketing(
  pool: pg.Pool,
  { region, currency, amountMinor }: (typeof MARKETING_BUDGET)[number],
): Promise<void> {
  // FundMarketing's id scheme, with a fixed id per region.
  const id = `seed_marketing_budget_${region}`;
  const transferId = `led_txn_fund_marketing_${id}`;
  const cash = `plat_${region}_marketing_cash`;
  const equity = `plat_${region}_platform_equity`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE yourtal_ledger");
    const done = await client.query("SELECT 1 FROM ledger.marketing_funding WHERE id = $1", [id]);
    if (done.rowCount === 0) {
      // ensureChart's rows for these two accounts; an existing one is left as it is.
      await client.query(
        `INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country, purpose)
         VALUES ($1, 'platform', 'platform', $3, 'asset', $4, 'main'),
                ($2, 'platform', 'platform', $3, 'equity', $4, 'main')
         ON CONFLICT (id) DO NOTHING`,
        [cash, equity, currency, region],
      );
      await client.query(
        `INSERT INTO ledger.transfer (id, idempotency_key, reason_code)
         VALUES ($1, $2, 'fund_marketing')`,
        [transferId, `fund_marketing_${id}`],
      );
      // Credit-positive: the asset's debit is negative.
      await client.query(
        `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
         VALUES ($1, $2, $4, $5), ($1, $3, $6, $5)`,
        [transferId, cash, equity, -amountMinor, currency, amountMinor],
      );
      await client.query(
        `INSERT INTO ledger.marketing_funding (id, region, amount_minor, proposed_by, approved_by, transfer_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, region, amountMinor, PROPOSED_BY, APPROVED_BY, transferId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

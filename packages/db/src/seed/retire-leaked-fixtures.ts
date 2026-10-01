import type pg from "pg";

/**
 * On 2026-09-26 the ledger-client contract spec wrote two of its own fixture
 * campaigns ("ledger-client contract fixture", `https://example.test`
 * posters) into staging's database, and they showed in every ID viewer's
 * feed. End them, matched on the spec's own fixed title and merchant name so
 * no real campaign can match. Runs every deploy; a no-op once ended.
 */
export async function retireLeakedFixtures(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<{ retired: number }> {
  const result = await pool.query(
    `UPDATE campaign.campaigns SET lifecycle_state = 'ended'
      WHERE ((title = 'ledger-client contract fixture' AND merchant_name = 'contract-spec merchant')
             -- 13.4.e: two more from a 2026-09-25 contract run, each under its own
             -- "Ledger contract test <id>" business, though named Snap App.
             OR (title LIKE 'Ledger contract test %'
                 AND business_id IN (SELECT id FROM business.business_accounts
                                      WHERE display_name LIKE 'Ledger contract test %')))
        AND lifecycle_state <> 'ended'`,
  );
  const retired = result.rowCount ?? 0;
  if (retired > 0) log(`[seed:leaked-fixtures] ${String(retired)} test fixture campaigns ended`);
  return { retired };
}

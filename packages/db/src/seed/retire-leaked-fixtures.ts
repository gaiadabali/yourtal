import type pg from "pg";

/**
 * On 2026-09-26 the ledger-client contract spec wrote two of its own fixture
 * campaigns ("ledger-client contract fixture", `https://example.test`
 * posters) into staging's database, and they showed in every ID viewer's
 * feed. End them, matched on the spec's own fixed title and merchant name so
 * no real campaign can match. Runs every deploy; a no-op once ended.
 *
 * 5.13.j: the same for the Studio journey (apps/web/e2e/journeys/j03), which
 * publishes a campaign titled "Journey 3 <AU|ID> <base36 time>" on whichever
 * site it runs against and, before it ended its own, left it live on the
 * landing page and Home. Matched on that exact title shape, never a prefix.
 * Journey 4's listing ("Journey 4 flat white <AU|ID> <base36 time>", maybe " large")
 * is retired the same way.
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
                                      WHERE display_name LIKE 'Ledger contract test %'))
             OR title ~ '^Journey 3 (AU|ID) [0-9a-z]+( sim-block-me)?$')
        -- Only live and paused may end (campaign.assert_lifecycle_transition); a draft, one in
        -- review or a rejected one never reaches a viewer, and ending it would fail the deploy.
        AND lifecycle_state IN ('live', 'paused')`,
  );
  const listings = await pool.query(
    `UPDATE store.listings SET lifecycle_state = 'retired'
      WHERE title ~ '^Journey 4 flat white (AU|ID) [0-9a-z]+( large)?$'
        AND lifecycle_state <> 'retired'`,
  );
  const retired = (result.rowCount ?? 0) + (listings.rowCount ?? 0);
  if (retired > 0) log(`[seed:leaked-fixtures] ${String(retired)} test fixtures ended or retired`);
  return { retired };
}

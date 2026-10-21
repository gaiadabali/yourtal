import type pg from "pg";
import { receiptFunderKey } from "@yourtal/contracts/billing/receipt-funder";
import { SNAP_APP_AU_ID, SNAP_APP_ID_ID } from "./staging";

/**
 * Demo receipt funders on staging and in dev (2.10.b, docs/27 3.1): the
 * partner `snap-app` is funded by its own sister-company business in each
 * region, so a demo environment can sell and draw a receipt package.
 * Production gets nothing until finance names the real business.
 *
 * Idempotent, and it never overrides a person: once any approved
 * `receipt_funder.snap-app` exists for a region (this seed's or finance's), that
 * region is left alone. It writes nothing when the partner or the region's
 * business is missing, since the setting would name nothing real.
 */
const PARTNER_ID = "snap-app";

const DEMO_FUNDERS = [
  { region: "AU", businessId: SNAP_APP_AU_ID },
  { region: "ID", businessId: SNAP_APP_ID_ID },
] as const;

export async function ensureDemoReceiptFunders(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<number> {
  const key = receiptFunderKey(PARTNER_ID);
  let seeded = 0;
  for (const { region, businessId } of DEMO_FUNDERS) {
    const { rowCount } = await pool.query(
      `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
       SELECT $1, $2, $3::jsonb, 'seed-demo', 'seed-demo-approval', now()
        WHERE EXISTS (SELECT 1 FROM platform.partner_credential WHERE partner_id = $4)
          AND EXISTS (SELECT 1 FROM business.business_accounts WHERE id = $5::uuid AND region = $1)
          AND NOT EXISTS (
            SELECT 1 FROM platform.region_setting
             WHERE region = $1 AND key = $2 AND approved_by IS NOT NULL)`,
      [region, key, JSON.stringify({ businessId }), PARTNER_ID, businessId],
    );
    if (rowCount === 1) {
      seeded += 1;
      log(`[seed] demo receipt funder for ${PARTNER_ID} set for ${region}`);
    }
  }
  return seeded;
}

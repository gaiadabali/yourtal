import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REGIONS,
  available,
  buy,
  eventually,
  fundedViewer,
  live,
  shop,
  startJourney,
  stopJourney,
  type Journey,
} from "./journey-fixtures";

/**
 * Journey 10 (product-intent §2.2), both regions:
 * - a voucher left unused past its expiry is expired by the voucher service's
 *   own sweep, leaves the wallet's spendable list, and the ledger releases its
 *   settlement value from voucher_liability (VoucherExpiry), once;
 * - points do not expire: the founder's default is off in both regions
 *   (F2), so an inactive balance stays whole.
 * The expiry date is backdated as the owner; the sweep and the ledger post run
 * on the services' own schedule (one minute and five seconds).
 */
let j: Journey | undefined;

beforeAll(async () => {
  if (live) j = await startJourney();
}, 240_000);
afterAll(async () => {
  if (live) await stopJourney(j);
});

describe.skipIf(!live)("J10 lifecycle", () => {
  it.each(REGIONS)(
    "%s: an unused voucher expires and its liability is released once",
    async (region) => {
      const journey = j!;
      const s = await shop(journey, region);
      const viewer = await fundedViewer(journey, region);
      const { voucherId } = await buy(journey, viewer, s.listingId);
      await journey.owner.execute(sql`
      UPDATE voucher.vouchers SET issued_at = now() - interval '2 days',
             expires_at = now() - interval '1 minute' WHERE id = ${voucherId}`);

      await eventually(async () => {
        const rows = await journey.owner.execute<{ state: string }>(
          sql`SELECT state FROM voucher.vouchers WHERE id = ${voucherId}`,
        );
        return rows.rows[0]?.state === "expired";
      }, 90_000);

      const transferId = `led_txn_voucher_expire_${voucherId}`;
      await eventually(async () => {
        const rows = await journey.owner.execute(
          sql`SELECT 1 FROM ledger.transfer WHERE id = ${transferId}`,
        );
        return rows.rows.length === 1;
      }, 30_000);
      const entries = await journey.owner.execute<{ account_id: string; amount_minor: string }>(sql`
      SELECT account_id, amount_minor::text FROM ledger.entry WHERE transfer_id = ${transferId}
       ORDER BY account_id`);
      expect(entries.rows).toEqual([
        {
          account_id: `plat_${region}_redemption_clearing`,
          amount_minor: String(s.settlementMinor),
        },
        {
          account_id: `plat_${region}_voucher_liability`,
          amount_minor: String(-s.settlementMinor),
        },
      ]);

      const wallet = await journey.app.inject({
        method: "GET",
        url: "/api/wallet/vouchers",
        headers: { cookie: viewer.cookie },
      });
      const vouchers = wallet.json<{ vouchers: { voucherId: string; status?: string }[] }>()
        .vouchers;
      expect(vouchers.find((v) => v.voucherId === voucherId)?.status).not.toBe("active");
    },
    180_000,
  );

  it.each(REGIONS)(
    "%s: points never expire while the region has expiry off (the default)",
    async (region) => {
      const journey = j!;
      const setting = await journey.owner.execute<{ enabled: boolean }>(sql`
      SELECT (value->>'enabled')::boolean AS enabled FROM platform.region_setting
       WHERE region = ${region} AND key = 'points_expiry'
       ORDER BY effective_from DESC LIMIT 1`);
      expect(setting.rows[0]?.enabled).toBe(false);

      const viewer = await fundedViewer(journey, region);
      const balance = await available(journey, viewer);
      // Thirteen months without activity.
      await journey.owner.execute(sql`
      UPDATE ledger.account SET last_activity_at = now() - interval '13 months'
       WHERE owner_type = 'user' AND owner_id = ${viewer.userId}`);
      expect(await available(journey, viewer)).toBe(balance);
      const breakage = await journey.owner.execute(sql`
      SELECT 1 FROM ledger.transfer t JOIN ledger.entry e ON e.transfer_id = t.id
       WHERE t.reason_code = 'points_expire' AND e.account_id LIKE ${`usr_${viewer.userId}_%`}`);
      expect(breakage.rows).toEqual([]);
    },
  );
});

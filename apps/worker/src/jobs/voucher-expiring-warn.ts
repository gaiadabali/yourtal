import type { Pool } from "pg";
import { createPool } from "../pool";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import { isPushEnabledFor } from "../push-default";
import { isTeenInQuietHours } from "../teen-quiet-hours";

/**
 * TASKS.md 13.3.i: once a day, tell each owner about their active, unredeemed
 * vouchers that end within 7 days: one in-app notification (`me.notification`,
 * the same table the points warning writes) and a simulated push where their
 * preference allows it.
 *
 * Never twice: `me.voucher_expiry_warning` holds one row per voucher, and the
 * claim and the notification are one SQL statement, so a retry, a re-run or a
 * second worker cannot warn again. A teen gets the in-app row like anyone
 * else; their push follows the teen defaults (off unless they turned it on,
 * and never in quiet hours). Nobody but the owner is ever named.
 *
 * `LEDGER_MODE=live` reads the voucher service's own table; the fake mode used
 * in dev and CI reads FakeVoucherClient's, where "active" is derived the same
 * way the wallet derives it.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
export const WARNING_WINDOW_DAYS = 7;
export const VOUCHER_EXPIRING_CATEGORY = "voucher_expiring";

const LIVE_VOUCHERS = `
  SELECT id, owner_id::text AS owner_id, title, expires_at
    FROM voucher.vouchers WHERE state = 'active'`;

const FAKE_VOUCHERS = `
  SELECT v.id, v.owner_id::text AS owner_id, l.title, v.expires_at
    FROM platform.voucher_fake_voucher v JOIN store.listings l ON l.id = v.listing_id
   WHERE v.state = 'activated' AND v.void_reason IS NULL
     AND v.remaining_value_minor > 0 AND v.owner_id IS NOT NULL`;

function claimSql(source: string): string {
  return `
  WITH candidate AS (${source}),
  due AS (
    SELECT c.id AS voucher_id, p.user_id, p.region, c.expires_at, c.title
      FROM candidate c JOIN identity.user_profile p ON p.user_id = c.owner_id
     WHERE c.expires_at > now() AND c.expires_at <= now() + make_interval(days => $2)
       AND NOT EXISTS (SELECT 1 FROM me.voucher_expiry_warning w WHERE w.voucher_id = c.id)
     ORDER BY c.expires_at
     LIMIT $1
  ),
  claimed AS (
    INSERT INTO me.voucher_expiry_warning (voucher_id, user_id, region, expires_at)
    SELECT voucher_id, user_id, region, expires_at FROM due
    ON CONFLICT (voucher_id) DO NOTHING
    RETURNING voucher_id, user_id, region, expires_at
  ),
  noted AS (
    INSERT INTO me.notification (user_id, region, category, title, body, metadata)
    SELECT c.user_id, c.region, '${VOUCHER_EXPIRING_CATEGORY}', 'Voucher ending soon',
           format('Your %s voucher ends on %s.', d.title, to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
           jsonb_build_object(
             'voucherId', c.voucher_id,
             'rewardTitle', d.title,
             'expiresAt', to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      FROM claimed c JOIN due d USING (voucher_id)
    RETURNING user_id, region, title, body, metadata->>'voucherId' AS voucher_id
  )
  SELECT user_id, region, title, body, voucher_id FROM noted`;
}

interface Warned {
  readonly user_id: string;
  readonly region: "AU" | "ID";
  readonly title: string;
  readonly body: string;
  readonly voucher_id: string;
}

const push = createSimulatedPush();

/** Returns how many vouchers this run warned about. Exported for tests. */
export async function warnExpiringVouchers(
  db: Pool,
  mode: "fake" | "live",
  now: Date = new Date(),
  pageSize = PAGE_SIZE,
): Promise<number> {
  const sql = claimSql(mode === "live" ? LIVE_VOUCHERS : FAKE_VOUCHERS);
  let warned = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows } = await db.query<Warned>(sql, [pageSize, WARNING_WINDOW_DAYS]);
    for (const row of rows) {
      // The in-app row is the record; the push is best effort on top of it.
      if (await isTeenInQuietHours(db, row.user_id, now)) continue;
      if (!(await isPushEnabledFor(db, row.user_id, VOUCHER_EXPIRING_CATEGORY, now))) continue;
      await push.send({
        idempotencyKey: `voucher_expiring_${row.voucher_id}`,
        to: row.user_id,
        region: row.region,
        category: VOUCHER_EXPIRING_CATEGORY,
        title: row.title,
        body: row.body,
      });
    }
    warned += rows.length;
    if (rows.length < pageSize) break;
  }
  return warned;
}

let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

export const job = defineJob({
  queue: "voucher.expiring_warn",
  // 01:00 UTC is 08:00-10:00 across Indonesia and 09:00-12:00 across Australia:
  // never a teen's quiet hours (21:00-07:00) in either region.
  schedule: "0 1 * * *",
  async handle(_job, { config }) {
    await warnExpiringVouchers(poolFor(config.databaseUrl), config.ledger.mode);
  },
});

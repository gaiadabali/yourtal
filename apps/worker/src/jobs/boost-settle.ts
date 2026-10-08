import type { Pool } from "pg";
import { createPool } from "../pool";
import { createPaymentsDriver } from "@yourtal/drivers/payments";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { defineJob } from "../job";

/**
 * 13.23.c: charges each closed day of boost spend through the payment
 * driver, once. A day is closed when it is over on its region's clock (F16).
 * The charge's idempotency key is the (campaign, day), so a retry after a
 * crash between the charge and the row insert replays the same charge; the
 * `boost_charge_once` constraint keeps the row single. Cash only: points and
 * rewards are never touched.
 */
let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

interface ClosedDay {
  readonly campaign_id: string;
  readonly business_id: string;
  readonly region: string;
  readonly currency: "AUD" | "IDR";
  readonly day: string;
  readonly impressions: number;
  readonly spent_milli: string;
}

export interface BoostSettleResult {
  readonly charged: number;
  readonly declined: number;
}

export async function runBoostSettle(
  db: Pool,
  payments: PaymentsDriver,
): Promise<BoostSettleResult> {
  const { rows } = await db.query<ClosedDay>(`
    SELECT s.campaign_id, b.business_id, b.region, b.currency, s.day::text AS day,
           s.impressions, s.spent_milli::text AS spent_milli
      FROM feed.boost_spend_day s
      JOIN feed.boost b ON b.campaign_id = s.campaign_id
      LEFT JOIN feed.boost_charge c ON c.campaign_id = s.campaign_id AND c.day = s.day
     WHERE c.id IS NULL AND s.spent_milli > 0
       AND s.day < (now() AT TIME ZONE CASE b.region WHEN 'AU' THEN 'Australia/Sydney'
                                                     ELSE 'Asia/Jakarta' END)::date
     ORDER BY s.day, s.campaign_id`);

  let charged = 0;
  let declined = 0;
  for (const row of rows) {
    // Thousandths of a minor unit, rounded up once per day to a whole unit.
    const amountMinor = Math.ceil(Number(row.spent_milli) / 1000);
    const key = `boost:${row.campaign_id}:${row.day}`;
    const charge = await payments.charge({
      idempotencyKey: key,
      amountMinor,
      currency: row.currency,
      reference: `studio-boost:${row.business_id}:${row.campaign_id}:${row.day}`,
    });
    if (charge.isErr()) {
      declined += 1;
      continue;
    }
    const inserted = await db.query(
      `INSERT INTO feed.boost_charge
         (campaign_id, business_id, region, currency, day, impressions, amount_minor, provider_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (campaign_id, day) DO NOTHING`,
      [
        row.campaign_id,
        row.business_id,
        row.region,
        row.currency,
        row.day,
        row.impressions,
        amountMinor,
        charge.value.providerReference,
      ],
    );
    charged += inserted.rowCount ?? 0;
  }
  return { charged, declined };
}

function paymentsDriver(): PaymentsDriver {
  const mode = resolveDriverMode("payments", process.env);
  if (mode.isErr()) throw new Error(describeProblem(mode.error));
  return createPaymentsDriver(mode.value, process.env);
}

export const job = defineJob({
  queue: "feed.boost_settle",
  // Hourly: each region's day closes at its own midnight, and a closed day
  // is charged within the hour after.
  schedule: "15 * * * *",
  async handle(_job, { config }) {
    await runBoostSettle(poolFor(config.databaseUrl), paymentsDriver());
  },
});

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/** What the weekly statement job needs of the ledger (live over HTTP, fake over the dev tables). */
export interface StatementLedger {
  /** Businesses in a region whose statement for [from, to) is still to be generated. */
  dueBusinesses(region: "AU" | "ID", from: string, to: string): Promise<string[]>;
  /** Idempotent per business, region and period. */
  generate(businessId: string, region: "AU" | "ID", from: string, to: string): Promise<void>;
}

const DISPUTE_WINDOW_DAYS = 7;

/**
 * `LEDGER_MODE=fake`: the same two answers, from `platform.ledger_fake_*`.
 * It mirrors the real ledger's (`services/ledger/internal/settlement`) and
 * apps/api's `generateStatementFake`, which this app may not import: due
 * means the merchant's captures or recoveries moved in the period, or it
 * holds a balance no statement ever covered, and never behind a statement
 * that ends after the period starts. An opening leaves out earlier
 * statements' positive closing (the fake does not post payouts, so paid or
 * not, they are still in the capture sums).
 */
export function createFakeStatementLedger(db: Pool): StatementLedger {
  return {
    async dueBusinesses(region, from, to) {
      const { rows } = await db.query<{ id: string }>(
        `SELECT m.merchant_id::text AS id
           FROM (SELECT DISTINCT merchant_id FROM platform.ledger_fake_capture WHERE region = $1) m
          WHERE NOT EXISTS (SELECT 1 FROM platform.ledger_fake_statement s
                             WHERE s.business_id = m.merchant_id AND s.region = $1
                               AND s.period_to > $2::timestamptz)
            AND (
              EXISTS (SELECT 1 FROM platform.ledger_fake_capture c
                       WHERE c.merchant_id = m.merchant_id AND c.region = $1
                         AND c.posted_at >= $2::timestamptz AND c.posted_at < $3::timestamptz)
              OR EXISTS (SELECT 1 FROM platform.ledger_fake_capture_recovery r
                          WHERE r.merchant_id = m.merchant_id AND r.region = $1
                            AND r.created_at >= $2::timestamptz AND r.created_at < $3::timestamptz)
              OR (
                NOT EXISTS (SELECT 1 FROM platform.ledger_fake_statement s
                             WHERE s.business_id = m.merchant_id AND s.region = $1)
                AND (SELECT COALESCE(SUM(c.amount_minor), 0) FROM platform.ledger_fake_capture c
                      WHERE c.merchant_id = m.merchant_id AND c.region = $1
                        AND c.posted_at < $3::timestamptz)
                  - (SELECT COALESCE(SUM(r.amount_minor), 0) FROM platform.ledger_fake_capture_recovery r
                      WHERE r.merchant_id = m.merchant_id AND r.region = $1
                        AND r.created_at < $3::timestamptz) <> 0))
          ORDER BY m.merchant_id`,
        [region, from, to],
      );
      return rows.map((row) => row.id);
    },

    async generate(businessId, region, from, to) {
      const sums = await db.query<{ opening: string; captures: string; recoveries: string }>(
        `SELECT
           (SELECT COALESCE(SUM(amount_minor), 0) FROM platform.ledger_fake_capture
             WHERE merchant_id = $1 AND region = $2 AND posted_at < $3::timestamptz)
           - (SELECT COALESCE(SUM(closing_payable_minor), 0) FROM platform.ledger_fake_statement
               WHERE business_id = $1 AND region = $2 AND period_to <= $3::timestamptz
                 AND closing_payable_minor > 0) AS opening,
           (SELECT COALESCE(SUM(amount_minor), 0) FROM platform.ledger_fake_capture
             WHERE merchant_id = $1 AND region = $2
               AND posted_at >= $3::timestamptz AND posted_at < $4::timestamptz) AS captures,
           (SELECT COALESCE(SUM(amount_minor), 0) FROM platform.ledger_fake_capture_recovery
             WHERE merchant_id = $1 AND region = $2
               AND created_at >= $3::timestamptz AND created_at < $4::timestamptz) AS recoveries`,
        [businessId, region, from, to],
      );
      const row = sums.rows[0];
      if (row === undefined) throw new Error("the fake statement sums returned no row");
      const opening = Number(row.opening);
      const captures = Number(row.captures);
      const recoveries = Number(row.recoveries);
      await db.query(
        `INSERT INTO platform.ledger_fake_statement
           (id, business_id, region, currency, period_from, period_to,
            opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
            closing_payable_minor, point_purchases_minor, point_purchases_points, dispute_window_ends_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, 0, $9, $10, 0, 0,
                 $6::timestamptz + make_interval(days => $11))
         ON CONFLICT (business_id, region, period_from, period_to) DO NOTHING`,
        [
          `stmt_fake_${randomUUID()}`,
          businessId,
          region,
          region === "AU" ? "AUD" : "IDR",
          from,
          to,
          opening,
          captures,
          recoveries,
          opening + captures - recoveries,
          DISPUTE_WINDOW_DAYS,
        ],
      );
    },
  };
}

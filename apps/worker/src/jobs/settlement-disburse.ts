import type { Pool } from "pg";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import type { PayoutAccountsDriver } from "@yourtal/drivers/payout-accounts";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * 5.2.b (F103, F104): an approved AU statement's payable leaves the platform
 * once. Each approved `approve_payout` proposal with a positive payable gets
 * one `payment.disbursement` row (unique per statement), with the amount the
 * approval stored. Then:
 *
 *   no ready account     -> awaiting_account (Studio asks the brand to set one up)
 *   ready                -> transfer to the brand's account, key `payout-transfer:<statementId>`,
 *                           then a payout to its bank, key `payout:<statementId>:<attempt>` -> transferred
 *   payout.paid          -> paid      (the API's webhook handler)
 *   payout.failed        -> failed    (the money is back in the account's balance)
 *   failed, and the account changed since -> the next attempt pays it out again
 *
 * The transfer key never changes, so a statement is transferred once, ever.
 * An answer that may have succeeded (timeout, 5xx) is asked again next run
 * with the same key; one still unknown near the provider's 24 h idempotency
 * window is never sent again and waits for staff. Indonesia is never
 * disbursed: the rows are AU only, in the query and in the table.
 */
let pool: Pool | undefined;
let driver: PayoutAccountsDriver | undefined;

const UNCONFIRMED_AFTER_MS = 23 * 60 * 60 * 1000;

type Outcome =
  "queued" | "awaiting_account" | "transferred" | "paid" | "failed" | "unsure" | "unconfirmed";
export type DisburseResult = Readonly<Record<Outcome, number>>;

interface Open {
  readonly id: string;
  readonly statement_id: string;
  readonly amount_minor: string;
  readonly status: "queued" | "awaiting_account" | "transferred" | "failed";
  readonly attempt: number;
  readonly account_ref: string | null;
  readonly transfer_ref: string | null;
  readonly transfer_requested_at: Date | null;
  readonly payout_requested_at: Date | null;
  readonly failed_at: Date | null;
  readonly live_account_ref: string | null;
  readonly ready: boolean | null;
  readonly live_bank_last4: string | null;
  readonly account_updated_at: Date | null;
}

/** One row per approved AU payout with a positive payable, read from what the approval stored. */
async function queueApproved(db: Pool): Promise<number> {
  const { rowCount } = await db.query(`
    INSERT INTO payment.disbursement (statement_id, proposal_id, business_id, region, currency, amount_minor)
    SELECT p.result->>'id', p.id, (p.result->>'businessId')::uuid, 'AU', 'AUD',
           (p.result->>'closingPayableMinor')::bigint
      FROM staff.economy_proposal p
     WHERE p.kind = 'approve_payout' AND p.status = 'approved' AND p.region = 'AU'
       AND p.result->>'region' = 'AU' AND p.result->>'currency' = 'AUD'
       AND p.result->>'id' = p.payload->>'statementId'
       AND p.result->>'businessId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND jsonb_typeof(p.result->'closingPayableMinor') = 'number'
       AND (p.result->>'closingPayableMinor') ~ '^[1-9][0-9]{0,17}$'
       AND NOT EXISTS (SELECT 1 FROM payment.disbursement d WHERE d.statement_id = p.result->>'id')
     ORDER BY p.decided_at
    ON CONFLICT (statement_id) DO NOTHING`);
  return rowCount ?? 0;
}

async function openRows(db: Pool, provider: string): Promise<Open[]> {
  const { rows } = await db.query<Open>(
    `SELECT d.id, d.statement_id, d.amount_minor::text AS amount_minor, d.status, d.attempt,
            d.account_ref, d.transfer_ref, d.transfer_requested_at, d.payout_requested_at, d.failed_at,
            a.account_ref AS live_account_ref, (a.charges_enabled AND a.payouts_enabled) AS ready,
            a.bank_last4 AS live_bank_last4, a.updated_at AS account_updated_at
       FROM payment.disbursement d
       LEFT JOIN payment.connected_account a
              ON a.owner_kind = 'business' AND a.owner_id = d.business_id AND a.provider = $1
      WHERE d.region = 'AU'
        AND (d.status IN ('queued', 'awaiting_account')
             OR (d.status = 'transferred' AND d.payout_ref IS NULL)
             OR (d.status = 'failed' AND d.failure_code NOT LIKE '%\\_unconfirmed'))
      ORDER BY d.created_at`,
    [provider],
  );
  return rows;
}

const stale = (since: Date | null, nowMs: number) =>
  since !== null && nowMs - since.getTime() > UNCONFIRMED_AFTER_MS;

async function fail(db: Pool, id: string, code: string, clear: "transfer" | "payout" | null) {
  // A refused request moved nothing, so its key may be sent afresh later.
  const reset =
    clear === "transfer"
      ? ", transfer_requested_at = NULL"
      : clear === "payout"
        ? ", payout_requested_at = NULL"
        : "";
  await db.query(
    `UPDATE payment.disbursement
        SET status = 'failed', failure_code = $2, failed_at = now(), updated_at = now()${reset}
      WHERE id = $1 AND status <> 'paid'`,
    [id, code],
  );
}

async function transfer(db: Pool, d: PayoutAccountsDriver, row: Open, nowMs: number) {
  if (stale(row.transfer_requested_at, nowMs)) {
    await fail(db, row.id, "transfer_unconfirmed", null);
    return { outcome: "unconfirmed" as const };
  }
  const accountRef = row.account_ref ?? row.live_account_ref;
  if (accountRef === null) throw new Error(`disbursement ${row.id} has no account`);
  // Written before the call: the account, and when this key was first sent.
  await db.query(
    `UPDATE payment.disbursement
        SET account_ref = coalesce(account_ref, $2), status = 'queued',
            transfer_requested_at = coalesce(transfer_requested_at, now()), updated_at = now()
      WHERE id = $1 AND transfer_ref IS NULL`,
    [row.id, accountRef],
  );
  const sent = await d.transfer({
    idempotencyKey: `payout-transfer:${row.statement_id}`,
    amountMinor: Number(row.amount_minor),
    currency: "AUD",
    accountRef,
    reference: `disbursement:${row.id}`,
  });
  if (sent.isErr()) {
    if (sent.error.mayHaveSucceeded) return { outcome: "unsure" as const };
    await fail(db, row.id, "transfer_declined", "transfer");
    return { outcome: "failed" as const };
  }
  await db.query(
    `UPDATE payment.disbursement
        SET transfer_ref = $2, status = 'transferred', transferred_at = now(), updated_at = now()
      WHERE id = $1 AND transfer_ref IS NULL`,
    [row.id, sent.value.transferRef],
  );
  return { outcome: "transferred" as const, accountRef };
}

async function payout(
  db: Pool,
  d: PayoutAccountsDriver,
  row: Open,
  accountRef: string,
  attempt: number,
  requestedAt: Date | null,
  nowMs: number,
): Promise<Outcome> {
  if (stale(requestedAt, nowMs)) {
    await fail(db, row.id, "payout_unconfirmed", null);
    return "unconfirmed";
  }
  await db.query(
    `UPDATE payment.disbursement
        SET payout_requested_at = coalesce(payout_requested_at, now()), bank_last4 = $3, updated_at = now()
      WHERE id = $1 AND attempt = $2 AND payout_ref IS NULL`,
    [row.id, attempt, row.live_bank_last4],
  );
  const sent = await d.payout({
    idempotencyKey: `payout:${row.statement_id}:${String(attempt)}`,
    amountMinor: Number(row.amount_minor),
    currency: "AUD",
    accountRef,
    reference: `disbursement:${row.id}:${String(attempt)}`,
  });
  if (sent.isErr()) {
    if (sent.error.mayHaveSucceeded) return "unsure";
    await fail(db, row.id, "payout_declined", "payout");
    return "failed";
  }
  // The webhook may have recorded the outcome first; never undo it.
  const paid = sent.value.status === "paid";
  await db.query(
    `UPDATE payment.disbursement
        SET payout_ref = $3, updated_at = now()${paid ? ", status = 'paid', paid_at = now()" : ""}
      WHERE id = $1 AND attempt = $2 AND payout_ref IS NULL AND status = 'transferred'`,
    [row.id, attempt, sent.value.payoutRef],
  );
  return paid ? "paid" : "transferred";
}

/** After a failure, once the account changed: the missing step again, a payout under the next attempt. */
async function retryAfterFailure(db: Pool, row: Open): Promise<Open | null> {
  const { rows } = await db.query<{ attempt: number; status: Open["status"] }>(
    `UPDATE payment.disbursement
        SET status = CASE WHEN transfer_ref IS NULL THEN 'queued' ELSE 'transferred' END,
            attempt = CASE WHEN transfer_ref IS NULL THEN attempt ELSE attempt + 1 END,
            payout_ref = CASE WHEN transfer_ref IS NULL THEN payout_ref END,
            payout_requested_at = NULL, failure_code = NULL, failed_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'failed' AND attempt = $2
      RETURNING attempt, status`,
    [row.id, row.attempt],
  );
  const updated = rows[0];
  return updated === undefined
    ? null
    : { ...row, attempt: updated.attempt, status: updated.status, payout_requested_at: null };
}

async function disburse(
  db: Pool,
  d: PayoutAccountsDriver,
  original: Open,
  nowMs: number,
): Promise<Outcome> {
  let row: Open | null = original;
  if (row.status === "failed") {
    const changedSince =
      row.account_updated_at !== null &&
      row.failed_at !== null &&
      row.account_updated_at > row.failed_at;
    if (row.ready !== true || !changedSince) return "failed";
    row = await retryAfterFailure(db, row);
    if (row === null) return "failed";
  }
  if (row.transfer_ref === null) {
    if (row.ready !== true) {
      await db.query(
        `UPDATE payment.disbursement SET status = 'awaiting_account', updated_at = now()
          WHERE id = $1 AND status = 'queued' AND transfer_ref IS NULL`,
        [row.id],
      );
      return "awaiting_account";
    }
    const moved = await transfer(db, d, row, nowMs);
    if (moved.outcome !== "transferred") return moved.outcome;
    return payout(db, d, row, moved.accountRef, row.attempt, null, nowMs);
  }
  if (row.account_ref === null) throw new Error(`disbursement ${row.id} has no account`);
  return payout(db, d, row, row.account_ref, row.attempt, row.payout_requested_at, nowMs);
}

export async function runSettlementDisburse(
  db: Pool,
  payouts: PayoutAccountsDriver,
  nowMs: () => number = Date.now,
): Promise<DisburseResult> {
  const counts: Record<Outcome, number> = {
    queued: await queueApproved(db),
    awaiting_account: 0,
    transferred: 0,
    paid: 0,
    failed: 0,
    unsure: 0,
    unconfirmed: 0,
  };
  for (const row of await openRows(db, payouts.provider)) {
    counts[await disburse(db, payouts, row, nowMs())] += 1;
  }
  return counts;
}

export const job = defineJob({
  queue: "payment.settlement_disburse",
  // Every five minutes: an approval, a finished onboarding or a bank update is paid soon after.
  schedule: "*/5 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    // Australia's payout driver only: Indonesia has no real payouts (F104).
    driver ??= createPaymentProviders(process.env).AU.payoutAccounts;
    await runSettlementDisburse(pool, driver);
  },
});

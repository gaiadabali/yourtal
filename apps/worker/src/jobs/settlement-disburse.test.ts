import { randomUUID } from "node:crypto";
import { err, ok } from "neverthrow";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createSimulatedPayoutAccounts } from "@yourtal/drivers/payout-accounts";
import type { MoneyToAccountRequest, PayoutAccountsDriver } from "@yourtal/drivers/payout-accounts";
import { runSettlementDisburse } from "./settlement-disburse";

/** 5.2.b against real Postgres: approved statements leave once, after approval, AU only. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

type Answer = "ok" | "timeout" | "declined";

/**
 * Stripe's shape: a key answers with the same id every time, as Stripe's
 * idempotency does. `script` lists answers per idempotency key, then "ok".
 */
function stripeShaped(script: Record<string, Answer[]> = {}) {
  const transfers: MoneyToAccountRequest[] = [];
  const payouts: MoneyToAccountRequest[] = [];
  const answer = (key: string): Answer => script[key]?.shift() ?? "ok";
  const failure = (a: Answer) =>
    err({
      kind: a === "timeout" ? ("timeout" as const) : ("declined" as const),
      boundary: "disbursement",
      detail: a,
      mayHaveSucceeded: a === "timeout",
    });
  const driver: PayoutAccountsDriver = {
    ...createSimulatedPayoutAccounts(),
    mode: "live",
    provider: "stripe",
    transfer: (request) => {
      transfers.push(request);
      const a = answer(request.idempotencyKey);
      return Promise.resolve(
        a === "ok" ? ok({ transferRef: `tr_${request.idempotencyKey}` }) : failure(a),
      );
    },
    payout: (request) => {
      payouts.push(request);
      const a = answer(request.idempotencyKey);
      return Promise.resolve(
        a === "ok"
          ? ok({ payoutRef: `po_${request.idempotencyKey}`, status: "pending" as const })
          : failure(a),
      );
    },
  };
  const mine = (list: MoneyToAccountRequest[], statementId: string) =>
    list.filter((r) => r.idempotencyKey.includes(statementId)).map((r) => r.idempotencyKey);
  return { driver, transfers, payouts, mine };
}

/** An approved payout proposal, storing what the ledger's approvePayout returned. */
async function approved(
  options: { region?: "AU" | "ID"; payableMinor?: number; businessId?: string } = {},
) {
  const statementId = randomUUID();
  const businessId = options.businessId ?? randomUUID();
  const region = options.region ?? "AU";
  const result = {
    id: statementId,
    businessId,
    region,
    currency: region === "AU" ? "AUD" : "IDR",
    closingPayableMinor: options.payableMinor ?? 12_345,
    status: "paid",
  };
  await pool.query(
    `INSERT INTO staff.economy_proposal (kind, region, summary, payload, result, proposed_by,
                                         approved_by, status, decided_at)
     VALUES ('approve_payout', $1, 'Payout', $2, $3, 'staff-a', 'staff-b', 'approved', now())`,
    [region, JSON.stringify({ statementId }), JSON.stringify(result)],
  );
  return { statementId, businessId };
}

async function connect(businessId: string, ready = true, provider = "stripe") {
  const accountRef = `acct_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  await pool.query(
    `INSERT INTO payment.connected_account (owner_kind, owner_id, region, provider, account_ref,
                                            charges_enabled, payouts_enabled, details_submitted, bank_last4)
     VALUES ('business', $1, 'AU', $2, $3, $4, $4, $4, '3456')`,
    [businessId, provider, accountRef, ready],
  );
  return accountRef;
}

async function row(statementId: string) {
  const { rows } = await pool.query<{
    status: string;
    attempt: number;
    amount_minor: string;
    transfer_ref: string | null;
    payout_ref: string | null;
    failure_code: string | null;
    bank_last4: string | null;
  }>(`SELECT * FROM payment.disbursement WHERE statement_id = $1`, [statementId]);
  return rows[0];
}

describe("settlement-disburse job", () => {
  it("transfers each approved statement once, with the approved amount, then pays it out", async () => {
    const { statementId, businessId } = await approved({ payableMinor: 98_765 });
    const accountRef = await connect(businessId);
    const stripe = stripeShaped();

    await runSettlementDisburse(pool, stripe.driver);
    await runSettlementDisburse(pool, stripe.driver);
    await Promise.all([
      runSettlementDisburse(pool, stripe.driver),
      runSettlementDisburse(pool, stripe.driver),
    ]);

    expect(stripe.mine(stripe.transfers, statementId)).toEqual([`payout-transfer:${statementId}`]);
    expect(stripe.mine(stripe.payouts, statementId)).toEqual([`payout:${statementId}:1`]);
    const sent = stripe.transfers.find((t) => t.idempotencyKey.includes(statementId));
    expect(sent).toMatchObject({ amountMinor: 98_765, currency: "AUD", accountRef });
    expect(await row(statementId)).toMatchObject({
      status: "transferred",
      attempt: 1,
      amount_minor: "98765",
      transfer_ref: `tr_payout-transfer:${statementId}`,
      payout_ref: `po_payout:${statementId}:1`,
      bank_last4: "3456",
    });
  });

  it("waits for a ready account, then pays", async () => {
    const { statementId, businessId } = await approved();
    const stripe = stripeShaped();

    await runSettlementDisburse(pool, stripe.driver);
    expect((await row(statementId))?.status).toBe("awaiting_account");

    await connect(businessId, false);
    await runSettlementDisburse(pool, stripe.driver);
    expect((await row(statementId))?.status).toBe("awaiting_account");
    expect(stripe.mine(stripe.transfers, statementId)).toEqual([]);

    await pool.query(
      `UPDATE payment.connected_account SET charges_enabled = true, payouts_enabled = true
        WHERE owner_id = $1`,
      [businessId],
    );
    await runSettlementDisburse(pool, stripe.driver);
    expect((await row(statementId))?.status).toBe("transferred");
    expect(stripe.mine(stripe.transfers, statementId)).toHaveLength(1);
  });

  it("asks again under the same keys after a timeout, and moves the money once", async () => {
    const { statementId, businessId } = await approved();
    await connect(businessId);
    const stripe = stripeShaped({
      [`payout-transfer:${statementId}`]: ["timeout"],
      [`payout:${statementId}:1`]: ["timeout"],
    });

    const first = await runSettlementDisburse(pool, stripe.driver);
    expect(first.unsure).toBeGreaterThanOrEqual(1);
    expect((await row(statementId))?.transfer_ref).toBeNull();

    await runSettlementDisburse(pool, stripe.driver); // transfer answers; the payout times out
    expect(await row(statementId)).toMatchObject({ status: "transferred", payout_ref: null });

    await runSettlementDisburse(pool, stripe.driver);
    expect(stripe.mine(stripe.transfers, statementId)).toEqual([
      `payout-transfer:${statementId}`,
      `payout-transfer:${statementId}`,
    ]);
    expect(stripe.mine(stripe.payouts, statementId)).toEqual([
      `payout:${statementId}:1`,
      `payout:${statementId}:1`,
    ]);
    expect((await row(statementId))?.payout_ref).toBe(`po_payout:${statementId}:1`);
  });

  it("never sends again a transfer still unknown near the 24 h idempotency window", async () => {
    const { statementId, businessId } = await approved();
    await connect(businessId);
    const stripe = stripeShaped({ [`payout-transfer:${statementId}`]: ["timeout"] });
    await runSettlementDisburse(pool, stripe.driver);
    await pool.query(
      `UPDATE payment.disbursement SET transfer_requested_at = now() - interval '23 hours 1 minute'
        WHERE statement_id = $1`,
      [statementId],
    );

    await runSettlementDisburse(pool, stripe.driver);
    await pool.query(
      `UPDATE payment.connected_account SET updated_at = now() WHERE owner_id = $1`,
      [businessId],
    );
    await runSettlementDisburse(pool, stripe.driver);

    expect(stripe.mine(stripe.transfers, statementId)).toHaveLength(1);
    expect(await row(statementId)).toMatchObject({
      status: "failed",
      failure_code: "transfer_unconfirmed",
    });
  });

  it("pays a failed payout again under the next attempt only after the account changed", async () => {
    const { statementId, businessId } = await approved();
    await connect(businessId);
    const stripe = stripeShaped();
    await runSettlementDisburse(pool, stripe.driver);
    // What the API's payout.failed handler writes.
    await pool.query(
      `UPDATE payment.disbursement SET status = 'failed', failure_code = 'no_account', failed_at = now()
        WHERE statement_id = $1`,
      [statementId],
    );

    await runSettlementDisburse(pool, stripe.driver);
    expect(stripe.mine(stripe.payouts, statementId)).toEqual([`payout:${statementId}:1`]);

    await pool.query(
      `UPDATE payment.connected_account SET bank_last4 = '7890', updated_at = now() WHERE owner_id = $1`,
      [businessId],
    );
    await runSettlementDisburse(pool, stripe.driver);
    await runSettlementDisburse(pool, stripe.driver);

    expect(stripe.mine(stripe.transfers, statementId)).toHaveLength(1);
    expect(stripe.mine(stripe.payouts, statementId)).toEqual([
      `payout:${statementId}:1`,
      `payout:${statementId}:2`,
    ]);
    expect(await row(statementId)).toMatchObject({
      status: "transferred",
      attempt: 2,
      failure_code: null,
      payout_ref: `po_payout:${statementId}:2`,
      bank_last4: "7890",
    });
  });

  it("marks a refused payout failed, and keeps the transfer", async () => {
    const { statementId, businessId } = await approved();
    await connect(businessId);
    const stripe = stripeShaped({ [`payout:${statementId}:1`]: ["declined"] });
    await runSettlementDisburse(pool, stripe.driver);
    expect(await row(statementId)).toMatchObject({
      status: "failed",
      failure_code: "payout_declined",
      transfer_ref: `tr_payout-transfer:${statementId}`,
    });
  });

  it("never disburses Indonesia, a zero payable, or an unapproved proposal", async () => {
    const id = await approved({ region: "ID" });
    const zero = await approved({ payableMinor: 0 });
    const pendingStatement = randomUUID();
    await pool.query(
      `INSERT INTO staff.economy_proposal (kind, region, summary, payload, proposed_by)
       VALUES ('approve_payout', 'AU', 'Payout', $1, 'staff-a')`,
      [JSON.stringify({ statementId: pendingStatement })],
    );
    const stripe = stripeShaped();
    await runSettlementDisburse(pool, stripe.driver);
    for (const statementId of [id.statementId, zero.statementId, pendingStatement]) {
      expect(await row(statementId)).toBeUndefined();
      expect(stripe.mine(stripe.transfers, statementId)).toEqual([]);
    }
    await expect(
      pool.query(
        `INSERT INTO payment.disbursement (statement_id, proposal_id, business_id, region, currency, amount_minor)
         SELECT 'x-' || gen_random_uuid(), id, gen_random_uuid(), 'ID', 'IDR', 1000
           FROM staff.economy_proposal LIMIT 1`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("is paid at once by the simulated provider", async () => {
    const { statementId, businessId } = await approved();
    const sim = createSimulatedPayoutAccounts();
    // The simulated provider's own account, as the API would have stored it.
    const created = await sim.createAccount({
      idempotencyKey: `connected-account:business:${businessId}`,
      reference: `business:${businessId}`,
      kind: "business",
      payoutSchedule: "manual",
    });
    if (created.isErr()) throw new Error(created.error.detail);
    const accountRef = created.value.accountRef;
    await pool.query(
      `INSERT INTO payment.connected_account (owner_kind, owner_id, region, provider, account_ref,
                                              charges_enabled, payouts_enabled, details_submitted, bank_last4)
       VALUES ('business', $1, 'AU', 'simulated', $2, true, true, true, '3456')`,
      [businessId, accountRef],
    );
    await runSettlementDisburse(pool, sim);
    expect((await row(statementId))?.status).toBe("paid");
  });
});

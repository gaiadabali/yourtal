import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "./database-urls";

/**
 * The redemption network's invariants, driven against real Postgres.
 * YT-0141 / YT-0150 / YT-0151 / YT-0153.
 *
 * ## Why these are database constraints and not service checks
 *
 * docs/09 §8 takes the authorize → capture → void/refund shape from card
 * networks. The failure modes are not crashes: a voucher held twice, a
 * capture larger than its authorization, refunds totalling more than was
 * captured. Each is a correct-looking sequence of statements that nothing
 * objects to unless the schema does — and each one is money, found by a
 * merchant, after settlement.
 *
 * ## Every case here is a REFUSAL that was watched to happen
 *
 * `docs/13c-lessons.md`: prove a check by breaking what it is meant to
 * catch. A constraint suite made only of rows that succeed proves the table
 * accepts data, which was never in doubt.
 *
 * Written as the OWNER. The app role cannot write these tables at all since
 * YT-0142, so running as the app would have every statement refused by a
 * grant before any constraint was reached — a suite that passed while
 * testing nothing.
 */

const { Pool } = pg;

let owner: pg.Pool;
let listingId: string;
let voucherId: string;

beforeAll(async () => {
  owner = new Pool({ connectionString: OWNER_URL, max: 4 });

  const { rows } = await owner.query<{ id: string; listing_id: string }>(
    `SELECT id, listing_id FROM voucher.vouchers ORDER BY id LIMIT 1`,
  );
  voucherId = rows[0]?.id ?? "";
  listingId = rows[0]?.listing_id ?? "";
  expect(voucherId, "run `pnpm db:seed` first — these need a real voucher").not.toBe("");

  await clearProbeRows();
});

afterAll(async () => {
  await clearProbeRows();
  await owner.end();
});

/**
 * One merchant for the whole suite.
 *
 * It used to be `gen_random_uuid()` per call, which quietly disarmed the
 * duplicate-order test: the unique index is on (merchant_id,
 * merchant_order_ref), so two holds with the same order reference and
 * different merchants are not duplicates and were never meant to collide.
 * The test passed nothing and reported success — the exact shape the
 * lessons log keeps recording, reproduced inside a suite written to catch
 * it.
 */
const MERCHANT = "77777777-7777-4777-8777-777777777777";

/**
 * A per-run prefix for every order reference this suite writes.
 *
 * Fixed strings like `probe-first` made the suite pass exactly once: the
 * `(merchant_id, merchant_order_ref)` index is unique, and `afterAll` only
 * runs if the file gets that far — so a run that failed part-way left rows
 * that made the NEXT run fail on a duplicate key, for a reason with nothing
 * to do with what it tests. That is how a real failure gets buried under a
 * fake one.
 */
const RUN = `probe-${Date.now()}`;

function ref(name: string): string {
  return `${RUN}-${name}`;
}

/** A held authorization against the seeded voucher, returning its id. */
async function placeHold(orderRef: string, amount: number): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO voucher.authorization
       (id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref, state, expires_at)
     VALUES (gen_random_uuid(), $1, $4, $2, 'IDR', $3, 'held',
             now() + interval '15 minutes')
     RETURNING id`,
    [voucherId, amount, orderRef, MERCHANT],
  );
  return rows[0]?.id ?? "";
}

/**
 * A clean start, not only a clean finish.
 *
 * Only one hold may be live on a voucher at a time — which is the point of
 * the index, and also means a test that leaves its hold behind makes every
 * later test fail for a reason that has nothing to do with what it checks.
 * That is how a real failure gets buried under a fake one.
 */
beforeEach(async () => {
  await owner.query(
    `UPDATE voucher.authorization SET state = 'voided', resolved_at = now()
      WHERE state = 'held' AND merchant_order_ref LIKE 'probe%'`,
  );
});

/**
 * A clean start, not only a clean finish — the rule `watch-session.test.ts`
 * already records. `afterAll` does not run when a file fails to load, so
 * relying on it alone means one bad run poisons every later one.
 */
async function clearProbeRows(): Promise<void> {
  await owner.query(
    `DELETE FROM voucher.refund WHERE capture_id IN (
       SELECT c.id FROM voucher.capture c
         JOIN voucher.authorization a ON a.id = c.authorization_id
        WHERE a.merchant_id = $1)`,
    [MERCHANT],
  );
  await owner.query(
    `DELETE FROM voucher.capture WHERE authorization_id IN (
       SELECT id FROM voucher.authorization WHERE merchant_id = $1)`,
    [MERCHANT],
  );
  await owner.query(`DELETE FROM voucher.authorization WHERE merchant_id = $1`, [MERCHANT]);
  await owner.query(`DELETE FROM voucher.kill_switch WHERE enabled_by = 'probe'`);
  await owner.query(`DELETE FROM voucher.batch WHERE funding_reference = 'probe'`);
}

describe("authorization", () => {
  it("refuses a second live hold on one voucher", async () => {
    // YT-0150: "concurrent authorize on one voucher is serialised". Two
    // tills scanning the same code at the same instant both read "no hold"
    // and both insert; only a unique index settles that, and a check in the
    // service cannot.
    await placeHold(ref("first"), 1000);

    await expect(placeHold(ref("second"), 500)).rejects.toThrow(
      /authorization_one_live_hold_per_voucher/,
    );

  });

  it("refuses two authorizations for one merchant order", async () => {
    // Without this, a merchant retrying a failed call with a fresh
    // idempotency key places a second hold on the same cart, and the
    // customer's voucher is held twice for one purchase.
    const first = await placeHold(ref("dup"), 1000);
    // Resolved first, so the second attempt collides on the ORDER REFERENCE
    // and not on the one-live-hold index — otherwise this test would pass
    // while exercising the other constraint entirely.
    await owner.query(
      `UPDATE voucher.authorization SET state = 'voided', resolved_at = now() WHERE id = $1`,
      [first],
    );

    await expect(placeHold(ref("dup"), 1000)).rejects.toThrow(
      /authorization_one_per_merchant_order/,
    );
  });

  it("refuses a hold that expires before it was created", async () => {
    await expect(
      owner.query(
        `INSERT INTO voucher.authorization
           (id, voucher_id, merchant_id, amount_minor, currency, merchant_order_ref,
            state, expires_at, created_at)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), 100, 'IDR', 'probe-past',
                 'held', now() - interval '1 hour', now())`,
        [voucherId],
      ),
    ).rejects.toThrow(/authorization_expires_after_creation/);
  });
});

describe("capture", () => {
  it("refuses a capture larger than its authorization", async () => {
    const authorization = await placeHold(ref("cap"), 3000);

    await expect(
      owner.query(
        `INSERT INTO voucher.capture
           (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
         VALUES (gen_random_uuid(), $1, 3000, 3001, '${ref('over')}')`,
        [authorization],
      ),
    ).rejects.toThrow(/capture_within_authorization/);
  });

  it("refuses a capture that lies about what it was authorized for", async () => {
    // The interesting one. `authorized_amount_minor` is a copy, and a copy
    // can disagree — so it is the second half of a COMPOSITE foreign key
    // back to the authorization. Claiming a larger authorization to justify
    // a larger capture therefore fails on the key, not on the amount.
    const authorization = await placeHold(ref("lie"), 3000);

    await expect(
      owner.query(
        `INSERT INTO voucher.capture
           (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
         VALUES (gen_random_uuid(), $1, 999999, 500000, '${ref('lie-receipt')}')`,
        [authorization],
      ),
    ).rejects.toThrow(/capture_authorization_id_authorized_amount_minor_fkey/);
  });

  it("refuses a second capture against one hold", async () => {
    const authorization = await placeHold(ref("twice"), 2000);
    await owner.query(
      `INSERT INTO voucher.capture
         (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
       VALUES (gen_random_uuid(), $1, 2000, 1000, '${ref('twice-a')}')`,
      [authorization],
    );

    // A double-spend wearing the clothes of a retry.
    await expect(
      owner.query(
        `INSERT INTO voucher.capture
           (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
         VALUES (gen_random_uuid(), $1, 2000, 1000, '${ref('twice-b')}')`,
        [authorization],
      ),
    ).rejects.toThrow(/capture_authorization_id_key/);
  });
});

describe("refund", () => {
  it("refuses refunds that together exceed the capture", async () => {
    // A statement about a SET of rows, so it cannot be a CHECK — the same
    // reason the ledger's balance invariant is a deferred constraint
    // trigger, and it fires at COMMIT rather than per row.
    const authorization = await placeHold(ref("refund"), 2000);
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO voucher.capture
         (id, authorization_id, authorized_amount_minor, amount_minor, receipt_id)
       VALUES (gen_random_uuid(), $1, 2000, 1200, '${ref('refund-receipt')}')
       RETURNING id`,
      [authorization],
    );
    const capture = rows[0]?.id ?? "";

    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO voucher.refund (id, capture_id, amount_minor, reason)
         VALUES (gen_random_uuid(), $1, 700, 'probe partial')`,
        [capture],
      );
      await client.query(
        `INSERT INTO voucher.refund (id, capture_id, amount_minor, reason)
         VALUES (gen_random_uuid(), $1, 700, 'probe the one that breaks it')`,
        [capture],
      );
      await expect(client.query("COMMIT")).rejects.toThrow(/exceeds the 1200 captured/);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

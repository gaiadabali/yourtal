import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "./database-urls";

/**
 * Issuance batches, the kill switch, and a deliberate sweep for the NULL
 * hole in `CHECK (a <> x OR b = y)`.
 *
 * Split from `voucher-constraints.test.ts` to stay under docs/15 rule 6's
 * 300 lines. The seam is that nothing here needs an authorization to exist
 * first — these are the constraints around issuance and incident response,
 * not around a transaction in flight.
 *
 * Written as the OWNER, for the same reason as its sibling: the app role
 * cannot write these tables at all since YT-0142, so running as the app
 * would have every statement refused by a grant before any constraint was
 * reached — a suite that passed while testing nothing.
 */

const { Pool } = pg;

let owner: pg.Pool;
let listingId: string;

beforeAll(async () => {
  owner = new Pool({ connectionString: OWNER_URL, max: 4 });

  const { rows } = await owner.query<{ listing_id: string }>(
    `SELECT listing_id FROM voucher.vouchers ORDER BY id LIMIT 1`,
  );
  listingId = rows[0]?.listing_id ?? "";
  expect(listingId, "run `pnpm db:seed` first — these need a real listing").not.toBe("");

  // A clean start, not only a clean finish: `afterAll` does not run when a
  // file fails to load, so relying on it alone means one bad run poisons
  // every later one.
  await owner.query(`DELETE FROM voucher.kill_switch WHERE enabled_by = 'probe'`);
  await owner.query(`DELETE FROM voucher.batch WHERE funding_reference = 'probe'`);
  await owner.query(`DELETE FROM voucher.merchant_credential WHERE key_id LIKE 'probe-%'`);
});

afterAll(async () => {
  await owner.query(`DELETE FROM voucher.kill_switch WHERE enabled_by = 'probe'`);
  await owner.query(`DELETE FROM voucher.batch WHERE funding_reference = 'probe'`);
  await owner.query(`DELETE FROM voucher.merchant_credential WHERE key_id LIKE 'probe-%'`);
  await owner.end();
});

describe("issuance batches", () => {
  const batch = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    requested_by: "44444444-4444-4444-8444-444444444444",
    approved_by: null,
    state: "requested",
    face: 5_000_000,
    settlement: 1_500_000,
    approved_at: null,
    ...overrides,
  });

  async function insert(values: Record<string, unknown>): Promise<void> {
    await owner.query(
      `INSERT INTO voucher.batch (id, listing_id, supplier_business_id, requested_by,
         approved_by, quantity, face_value_minor, settlement_value_minor, currency,
         transferable, partial_redemption_policy, expires_at, funding_reference, state,
         approved_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, $3, 100, $4, $5, 'IDR', false,
               'balance_carrying', now() + interval '90 days', 'probe', $6, $7)`,
      [
        listingId,
        values.requested_by,
        values.approved_by,
        values.face,
        values.settlement,
        values.state,
        values.approved_at,
      ],
    );
  }

  it("refuses an approval given by the person who requested it", async () => {
    // YT-0141's two-person rule. An approval you can give yourself is a form
    // on a screen, and what is being authorised is the creation of bearer
    // instruments with face value.
    const self = "44444444-4444-4444-8444-444444444444";
    await expect(
      insert(batch({ approved_by: self, state: "approved", approved_at: "now()" })),
    ).rejects.toThrow(/batch_approver_is_a_second_person|batch_approved_at_iff_approver/);
  });

  it("refuses minting with no approver at all", async () => {
    await expect(insert(batch({ state: "minting" }))).rejects.toThrow(
      /batch_approved_state_has_an_approver/,
    );
  });

  it("refuses a settlement value above face value", async () => {
    // An economic invariant, not a formatting rule: settlement above face
    // means the platform pays out more than the voucher was ever worth, on
    // every redemption, silently.
    await expect(insert(batch({ face: 1_500_000, settlement: 5_000_000 }))).rejects.toThrow(
      /batch_settlement_within_face/,
    );
  });
});

describe("the kill switch", () => {
  it("refuses a second live switch on one scope", async () => {
    // "Is this merchant stopped?" must be one row, not an aggregate over a
    // history — in an incident, nobody should have to reduce a table to get
    // a yes or no.
    await owner.query(
      `INSERT INTO voucher.kill_switch (id, scope, reason, enabled_by)
       VALUES (gen_random_uuid(), 'global', 'probe drill', 'probe')`,
    );

    await expect(
      owner.query(
        `INSERT INTO voucher.kill_switch (id, scope, reason, enabled_by)
         VALUES (gen_random_uuid(), 'global', 'probe second', 'probe')`,
      ),
    ).rejects.toThrow(/kill_switch_one_live_per_scope/);
  });
});

/**
 * The NULL hole, swept for deliberately.
 *
 * `CHECK (a <> x OR b = y)` PASSES when `b` is NULL, because `FALSE OR NULL`
 * is NULL and Postgres accepts a CHECK that evaluates to NULL. e3 shipped
 * one of these and found it refused two of three wrong states — which is
 * precisely why it looked correct.
 *
 * Three constraints in these schemas use the `OR` form. Each is asserted at
 * its NULL case below rather than reasoned about, because the whole lesson
 * is that this shape reads as correct.
 */
describe("constraints of the shape that hides a NULL hole", () => {
  it("refuses a superseded credential with no deadline", async () => {
    // CHECK (state <> 'superseded' OR not_after IS NOT NULL). Immune because
    // the right side is an IS NOT NULL test, which is never itself NULL.
    await expect(
      owner.query(
        `INSERT INTO voucher.merchant_credential (key_id, merchant_id, wrapped_data_key,
           nonce, ciphertext, key_purpose, key_version, state, not_after)
         VALUES ('probe-null', gen_random_uuid(), '\\x00', '\\x00', '\\x00',
                 'merchant_hmac', 1, 'superseded', NULL)`,
      ),
    ).rejects.toThrow(/credential_superseded_has_a_deadline/);
  });

  it("refuses a sold-out listing that still has stock", async () => {
    // CHECK (status <> 'sold_out' OR stock_remaining = 0). Immune because
    // stock_remaining is NOT NULL.
    await expect(
      owner.query(`UPDATE store.listings SET status = 'sold_out' WHERE stock_remaining > 0`),
    ).rejects.toThrow(/listings_sold_out_has_no_stock/);
  });

  it("catches an unapproved batch through its companion constraint", async () => {
    // CHECK (approved_by IS NULL OR approved_by <> requested_by) DOES pass
    // when approved_by is NULL — deliberately, because a batch that has been
    // requested and not yet approved is a legitimate row.
    //
    // So this one is only safe as a PAIR: `batch_approved_state_has_an_approver`
    // uses `IS NOT NULL` and is what refuses a null approver in a state that
    // mints. Asserted here because the first constraint on its own looks
    // exactly like the hole, and a later reader deleting the companion as
    // redundant would open it.
    await expect(
      owner.query(
        `INSERT INTO voucher.batch (id, listing_id, supplier_business_id, requested_by,
           approved_by, quantity, face_value_minor, settlement_value_minor, currency,
           transferable, partial_redemption_policy, expires_at, funding_reference, state)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), gen_random_uuid(), NULL, 1,
                 1000, 500, 'IDR', false, 'balance_carrying', now() + interval '1 day',
                 'probe', 'minted')`,
        [listingId],
      ),
    ).rejects.toThrow(/batch_approved_state_has_an_approver/);
  });
});

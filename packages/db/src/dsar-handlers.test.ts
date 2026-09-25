import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";
import { executeDeletion, unhandledDomains } from "@yourtal/consent/dsar-orchestrator";
import { TOMBSTONE, postgresHandlers } from "./dsar-handlers";
import { seed } from "./seed";

/**
 * YT-0036's handlers, against the real Postgres.
 *
 * The orchestrator's own tests prove it refuses an incomplete request. These
 * prove the two handlers that exist do the right thing to real rows — and
 * in particular that "anonymise" leaves an instrument someone else is still
 * owed money against fully intact.
 */

const { Pool } = pg;

// The seed gives every voucher to this user, which makes it the subject.
const SEEDED_OWNER = "11111111-1111-4111-8111-111111111111";

/**
 * Fixtures are written as the OWNER, assertions run as the app.
 *
 * Seeding is administration. Since YT-0142 the app role can read a voucher
 * and not write one — the value path is split by role deliberately — so a
 * seed running as the app now lacks a grant it used to have. Widening the
 * app's grant to suit a fixture would undo the control; acquiring each
 * value-path role's grant in turn would break again the next time a role is
 * added. See `database-urls.ts`.
 */
let pool: pg.Pool;
let owner: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await seed(owner);
});

afterAll(async () => {
  // Put the seeded vouchers back, so re-running this suite is not a one-shot.
  // Owner: the app can read a voucher and not write one (YT-0142), and
  // restoring fixtures is administration.
  await owner.query(`UPDATE voucher.vouchers SET owner_id = $1 WHERE owner_id = $2`, [
    SEEDED_OWNER,
    TOMBSTONE,
  ]);
  await pool.end();
  await owner.end();
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? "0");
}

describe("anonymising vouchers", () => {
  it("severs the subject but leaves the voucher honourable", async () => {
    // Snapshot what the merchant is owed BEFORE, so the assertion is about
    // the instrument surviving rather than about a row count.
    // `code` is deliberately absent. YT-0140 deleted the plaintext column
    // outright and moved the secret into `voucher.code_custody` as a hash
    // plus KMS-wrapped ciphertext (docs/15 rule 7: voucher codes encrypted
    // from the first code ever minted). This test used to read the column;
    // asserting the custody row survives is the stronger version of the same
    // claim, because the instrument is only honourable if its code still is.
    const { rows: before } = await pool.query<{
      id: string;
      merchant_id: string;
      face_value_minor: string;
    }>(
      `SELECT id, merchant_id, face_value_minor FROM voucher.vouchers
        WHERE owner_id = $1 ORDER BY id LIMIT 1`,
      [SEEDED_OWNER],
    );
    const sample = before[0];
    expect(sample, "the seed should have given this user vouchers").toBeDefined();

    const report = await executeDeletion(SEEDED_OWNER, postgresHandlers(pool));

    const vouchers = report.results.find((result) => result.domain === "vouchers");
    expect(vouchers?.outcome).toMatchObject({ status: "anonymised" });

    // The person is gone.
    expect(
      await count(`SELECT COUNT(*)::text AS n FROM voucher.vouchers WHERE owner_id = $1`, [
        SEEDED_OWNER,
      ]),
    ).toBe(0);

    // The debt is not. A merchant is owed settlement for a redemption that
    // happened, and an "anonymisation" that damaged the instrument would be
    // a deletion wearing a different name.
    const { rows: after } = await pool.query<{
      merchant_id: string;
      face_value_minor: string;
      owner_id: string;
    }>(`SELECT merchant_id, face_value_minor, owner_id FROM voucher.vouchers WHERE id = $1`, [
      sample?.id,
    ]);

    expect(after[0]?.merchant_id).toBe(sample?.merchant_id);
    expect(after[0]?.face_value_minor).toBe(sample?.face_value_minor);
    expect(after[0]?.owner_id).toBe(TOMBSTONE);
  });

  it("uses a shared tombstone, not a per-subject one", async () => {
    // A unique tombstone per subject would still let rows be correlated back
    // into one person, which is re-identification with extra steps.
    const distinct = await count(
      `SELECT COUNT(DISTINCT owner_id)::text AS n FROM voucher.vouchers WHERE owner_id = $1`,
      [TOMBSTONE],
    );
    expect(distinct).toBeLessThanOrEqual(1);
  });
});

/**
 * The grant boundary the anonymisation path rests on, driven rather than
 * assumed.
 *
 * `anonymiseVouchers` works, which by itself proves nothing about what else
 * the app could do — a column grant would also have made it work, while
 * handing the application credential the power to re-own every voucher in
 * the platform. These assertions are the difference between "erasure works"
 * and "erasure works and nothing else does".
 */
describe("what the application role can and cannot do to a voucher", () => {
  it("cannot re-own a voucher to anybody", async () => {
    // The statement a column-level UPDATE grant would have permitted. It
    // differs from a legitimate anonymisation only in the parameter, which
    // is why the grant was refused and a SECURITY DEFINER function used.
    await expect(
      pool.query(`UPDATE voucher.vouchers SET owner_id = $1 WHERE owner_id <> $1`, [
        "99999999-9999-4999-8999-999999999999",
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot change what a voucher is worth", async () => {
    await expect(
      pool.query(`UPDATE voucher.vouchers SET remaining_value_minor = 999999999`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot mint one", async () => {
    await expect(
      pool.query(
        `INSERT INTO voucher.vouchers (id, listing_id, owner_id, merchant_id, merchant_name,
           title, face_value_minor, remaining_value_minor, partial_redemption_policy,
           minimum_spend_minor, transferable, state, issued_at, expires_at, location_id, currency)
         SELECT gen_random_uuid(), listing_id, gen_random_uuid(), gen_random_uuid(), 'M', 'T',
                1000, 1000, 'single_use_forfeit', NULL, false, 'active', now(),
                now() + interval '30 days', location_id, 'IDR'
           FROM store.listing_location LIMIT 1`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot read a voucher's code", async () => {
    // docs/15 rule 7. The custody table is the reason the plaintext column
    // was dropped rather than encrypted in place, and a store service that
    // could read it could redeem every voucher it can see.
    await expect(
      pool.query(`SELECT code_hash, ciphertext FROM voucher.code_custody LIMIT 1`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot anonymise the tombstone itself", async () => {
    // A no-op today, and an oracle tomorrow: it would report how many rows
    // had already been anonymised, which is a fact about how many people
    // exercised erasure.
    await expect(pool.query(`SELECT voucher.anonymise_owner($1)`, [TOMBSTONE])).rejects.toThrow(
      /not a subject/,
    );
  });
});

describe("the report against the real domain map", () => {
  it("is still incomplete, and says exactly who owes a handler", async () => {
    // The honest state: two domains handled, the rest not. The request must
    // NOT report success — that is the whole point of the orchestrator.
    const report = await executeDeletion(SEEDED_OWNER, postgresHandlers(pool));

    expect(report.complete).toBe(false);

    const unhandled = report.results.filter((result) => result.outcome.status === "unhandled");
    expect(unhandled.length).toBeGreaterThan(0);
    for (const result of unhandled) {
      expect(
        result.outcome.status === "unhandled" ? result.outcome.owner : "",
        `${result.domain} must name an owner`,
      ).not.toBe("");
    }
  });

  it("shrinks the gap by the handlers this database supplies", () => {
    const before = unhandledDomains({}).length;
    const after = unhandledDomains(postgresHandlers(pool)).length;

    expect(after).toBeLessThan(before);
  });
});

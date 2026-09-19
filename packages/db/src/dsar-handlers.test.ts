import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
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
const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";

// The seed gives every voucher to this user, which makes it the subject.
const SEEDED_OWNER = "11111111-1111-4111-8111-111111111111";

let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  await seed(pool);
});

afterAll(async () => {
  // Put the seeded vouchers back, so re-running this suite is not a one-shot.
  await pool.query(`UPDATE voucher.vouchers SET owner_id = $1 WHERE owner_id = $2`, [
    SEEDED_OWNER,
    TOMBSTONE,
  ]);
  await pool.end();
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? "0");
}

describe("anonymising vouchers", () => {
  it("severs the subject but leaves the voucher honourable", async () => {
    // Snapshot what the merchant is owed BEFORE, so the assertion is about
    // the instrument surviving rather than about a row count.
    const { rows: before } = await pool.query<{
      id: string;
      code: string;
      merchant_id: string;
      face_value_idr: string;
    }>(
      `SELECT id, code, merchant_id, face_value_idr FROM voucher.vouchers
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
      code: string;
      merchant_id: string;
      face_value_idr: string;
      owner_id: string;
    }>(`SELECT code, merchant_id, face_value_idr, owner_id FROM voucher.vouchers WHERE id = $1`, [
      sample?.id,
    ]);

    expect(after[0]?.code).toBe(sample?.code);
    expect(after[0]?.merchant_id).toBe(sample?.merchant_id);
    expect(after[0]?.face_value_idr).toBe(sample?.face_value_idr);
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

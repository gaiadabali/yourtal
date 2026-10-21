import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "../database-urls";
import { ensureDemoReceiptFunders } from "./demo-receipt-funders";
import { SNAP_APP_AU_ID, SNAP_APP_ID_ID } from "./staging";

/**
 * The demo receipt funder seed against real Postgres: writes each region once,
 * never over a person's approval, and nothing when the business or partner is
 * missing. It adapts to which Snap App businesses the shared test database holds.
 */
const { Pool } = pg;
let owner: pg.Pool;
/** The Snap App rows this file inserted because the shared database had none; removed again after. */
const inserted: string[] = [];
const quiet = () => undefined;
const KEY = "receipt_funder.snap-app";

beforeAll(async () => {
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  const fixtures = [
    [SNAP_APP_AU_ID, "AU", "AUD", "ABN", "51824753556", "NSW", "2010", null, "snap-app-au"],
    [
      SNAP_APP_ID_ID,
      "ID",
      "IDR",
      "NPWP",
      "0123456789012345",
      null,
      null,
      "Kebayoran Baru",
      "snap-app-id",
    ],
  ] as const;
  for (const [id, region, currency, kind, taxId, state, postcode, city, handle] of fixtures) {
    const { rowCount } = await owner.query(
      `INSERT INTO business.business_accounts
         (id, legal_name, display_name, tax_id_kind, tax_id_value, address_state,
          address_postcode, address_city, roles, is_verified, region, currency, handle)
       VALUES ($1, 'Snap App test', 'Snap App', $2, $3, $4, $5, $6, '["advertiser"]', true, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [id, kind, taxId, state, postcode, city, region, currency, handle],
    );
    if (rowCount === 1) inserted.push(id);
  }
});
afterAll(async () => {
  await clear();
  await owner.query(`DELETE FROM business.business_accounts WHERE id = ANY($1)`, [inserted]);
  await owner.end();
});
beforeEach(clear);

async function clear(): Promise<void> {
  await owner.query(
    `DELETE FROM platform.region_setting WHERE key = $1 AND set_by IN ('seed-demo', 't8-test')`,
    [KEY],
  );
}

async function existingBusinesses(): Promise<Record<string, string>> {
  const { rows } = await owner.query<{ id: string; region: string }>(
    `SELECT id, region FROM business.business_accounts WHERE id = ANY($1)`,
    [[SNAP_APP_AU_ID, SNAP_APP_ID_ID]],
  );
  return Object.fromEntries(rows.map((row) => [row.region, row.id]));
}

async function approved(): Promise<{ region: string; value: unknown; set_by: string }[]> {
  const { rows } = await owner.query<{ region: string; value: unknown; set_by: string }>(
    `SELECT region, value, set_by FROM platform.region_setting
      WHERE key = $1 AND approved_by IS NOT NULL ORDER BY region`,
    [KEY],
  );
  return rows;
}

describe("ensureDemoReceiptFunders", () => {
  it("names each region's Snap App business once, pre-approved, and only where the business exists", async () => {
    const businesses = await existingBusinesses();
    const expected = Object.keys(businesses).length;
    expect(await ensureDemoReceiptFunders(owner, quiet)).toBe(expected);
    const rows = (await approved()).filter((row) => row.set_by === "seed-demo");
    expect(rows).toEqual(
      Object.entries(businesses)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([region, businessId]) => ({ region, value: { businessId }, set_by: "seed-demo" })),
    );
    expect(await ensureDemoReceiptFunders(owner, quiet)).toBe(0);
    expect((await approved()).length).toBe(rows.length);
  });

  it("never overrides an approved row", async () => {
    const businesses = await existingBusinesses();
    for (const region of Object.keys(businesses)) {
      await owner.query(
        `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
         VALUES ($1, $2, $3::jsonb, 't8-test', 't8-approver', now())`,
        [region, KEY, JSON.stringify({ businessId: "11111111-1111-4111-8111-111111111111" })],
      );
    }
    expect(await ensureDemoReceiptFunders(owner, quiet)).toBe(0);
    const rows = await approved();
    expect(rows.every((row) => row.set_by === "t8-test")).toBe(true);
  });
});

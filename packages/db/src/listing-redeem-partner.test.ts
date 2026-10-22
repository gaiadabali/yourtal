import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "./database-urls";

/**
 * 2.8 T1: `store.listings.redeem_partner_id` and the shape a bound listing
 * must have (migration 20261022090000_listing_redeem_partner.sql).
 *
 * Written as the owner, like the other constraint suites: the app role's
 * grants are not what is under test, and a grant refusal would hide a CHECK
 * that never ran. Every refusal below is a row that WAS refused, and each
 * has a twin that is accepted, so a CHECK that refused everything (or a
 * column that did not exist) cannot pass.
 */

const { Pool, Client } = pg;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");
const bootstrapSql = path.resolve(here, "../../../infra/postgres/init/01-schemas.sql");
const THIS_MIGRATION = "20261022090000_listing_redeem_partner.sql";

const RUN = `probe28t1-${String(Date.now())}`;
const PARTNER = `${RUN}-partner`;

let owner: pg.Pool;

/** A valid, ORDINARY (unbound) listing, overridable per case. */
function listing(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    merchant_id: "00000000-0000-4000-8000-0000000028f2",
    merchant_name: "Probe merchant",
    title: "Probe",
    description: "Probe",
    category: "food_beverage",
    currency: "IDR",
    face_value_minor: 50_000,
    settlement_value_minor: 30_000,
    price_in_points: 5_000,
    stock_remaining: 5,
    stock_total: 10,
    transferable: false,
    partial_redemption_policy: "single_use_forfeit",
    minimum_spend_minor: null,
    expires_at: "2027-12-31T00:00:00Z",
    status: "available",
    region: "ID",
    audience: "all_ages",
    content_category: "food-and-drink",
    image_url: "https://cdn.example.com/probe.jpg",
    channel: "in_store",
    partial_redemption: "single_use",
    ...over,
  };
}

/** A listing that satisfies the bound shape. */
function bound(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return listing(id, { channel: "online", redeem_partner_id: PARTNER, ...over });
}

async function insert(client: pg.Pool | pg.Client, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  const placeholders = keys.map((_key, index) => `$${String(index + 1)}`).join(",");
  await client.query(
    `INSERT INTO store.listings (${keys.join(",")}) VALUES (${placeholders})`,
    Object.values(row),
  );
}

let next = 0;
function listingId(): string {
  next += 1;
  return `00000000-0000-4000-8000-${String(28_000_000_000 + next).padStart(12, "0")}`;
}

async function clear(): Promise<void> {
  await owner.query(
    `DELETE FROM store.listings WHERE title = 'Probe' AND merchant_name = 'Probe merchant'`,
  );
  await owner.query(`DELETE FROM platform.partner_credential WHERE partner_id = $1`, [PARTNER]);
}

beforeAll(async () => {
  owner = new Pool({ connectionString: OWNER_URL, max: 4 });
  await clear();
  await owner.query(
    `INSERT INTO platform.partner_credential (partner_id, secret_env_var) VALUES ($1, 'PROBE_28_T1')`,
    [PARTNER],
  );
});

afterAll(async () => {
  await clear();
  await owner.end();
});

describe("store.listings.redeem_partner_id", () => {
  it("is a nullable text column, NULL on every listing that existed before", async () => {
    const column = await owner.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'store' AND table_name = 'listings'
          AND column_name = 'redeem_partner_id'`,
    );
    expect(column.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);

    // The seeded catalogue was written before anyone could bind a listing.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM store.listings
        WHERE redeem_partner_id IS NOT NULL AND merchant_name <> 'Probe merchant'`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("ACCEPTS an ordinary listing with no partner, whatever its shape", async () => {
    // The CHECK is conditional on a binding: in-store, transferable and
    // balance-carrying listings are all still valid when unbound.
    await insert(owner, listing(listingId()));
    await insert(
      owner,
      listing(listingId(), {
        channel: "both",
        transferable: true,
        partial_redemption_policy: "balance_carrying",
        partial_redemption: "balance_carries",
      }),
    );
  });

  it("ACCEPTS a binding that is online, untransferable and single-use", async () => {
    const id = listingId();
    await insert(owner, bound(id));
    const { rows } = await owner.query<{ redeem_partner_id: string }>(
      `SELECT redeem_partner_id FROM store.listings WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.redeem_partner_id).toBe(PARTNER);
  });

  it("REFUSES a binding on an in-store listing", async () => {
    await expect(insert(owner, bound(listingId(), { channel: "in_store" }))).rejects.toThrow(
      /listings_bound_partner_shape/,
    );
  });

  it("REFUSES a binding on a listing sold both online and in store", async () => {
    // 'both' is not 'online': a counter could redeem it, which a partner-
    // bound voucher must never allow.
    await expect(insert(owner, bound(listingId(), { channel: "both" }))).rejects.toThrow(
      /listings_bound_partner_shape/,
    );
  });

  it("REFUSES a binding on a transferable listing", async () => {
    await expect(insert(owner, bound(listingId(), { transferable: true }))).rejects.toThrow(
      /listings_bound_partner_shape/,
    );
  });

  it("REFUSES a binding on a balance-carrying listing", async () => {
    // Both spellings of the rule are pinned, and each is refused on its own:
    // the fine policy alone, and the coarse enum alone.
    await expect(
      insert(owner, bound(listingId(), { partial_redemption_policy: "balance_carrying" })),
    ).rejects.toThrow(/listings_bound_partner_shape/);
    await expect(
      insert(owner, bound(listingId(), { partial_redemption: "balance_carries" })),
    ).rejects.toThrow(/listings_bound_partner_shape/);
    await expect(
      insert(
        owner,
        bound(listingId(), {
          partial_redemption_policy: "minimum_spend",
          minimum_spend_minor: 10_000,
        }),
      ),
    ).rejects.toThrow(/listings_bound_partner_shape/);
  });

  it("REFUSES an unknown partner id (foreign key)", async () => {
    await expect(
      insert(owner, bound(listingId(), { redeem_partner_id: `${RUN}-nobody` })),
    ).rejects.toThrow(/listings_redeem_partner_id_fkey/);
  });

  it("holds on UPDATE too: an existing listing cannot be bound into a bad shape", async () => {
    const inStore = listingId();
    await insert(owner, listing(inStore));
    await expect(
      owner.query(`UPDATE store.listings SET redeem_partner_id = $2 WHERE id = $1`, [
        inStore,
        PARTNER,
      ]),
    ).rejects.toThrow(/listings_bound_partner_shape/);

    // Moving it online makes the same bind valid...
    await owner.query(
      `UPDATE store.listings SET channel = 'online', redeem_partner_id = $2 WHERE id = $1`,
      [inStore, PARTNER],
    );
    // ...and once bound it cannot be made transferable again.
    await expect(
      owner.query(`UPDATE store.listings SET transferable = true WHERE id = $1`, [inStore]),
    ).rejects.toThrow(/listings_bound_partner_shape/);
  });

  it("will not let a partner with bound listings be deleted from under them", async () => {
    await expect(
      owner.query(`DELETE FROM platform.partner_credential WHERE partner_id = $1`, [PARTNER]),
    ).rejects.toThrow(/listings_redeem_partner_id_fkey/);
  });

  it("is indexed, partially: only bound listings are in the index", async () => {
    const { rows } = await owner.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'store' AND tablename = 'listings'
          AND indexname = 'listings_redeem_partner_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/\(redeem_partner_id\)/);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(redeem_partner_id IS NOT NULL\)/);
  });
});

/**
 * The migration against a database that already holds listings AND vouchers.
 *
 * The suite above runs on a database built from scratch, which proves the
 * migration applies on an empty one. The risk with an add-only migration is
 * the other case: a populated database, where the CHECK is validated against
 * every existing row and the voucher rows hang off those listings. So this
 * builds a second database, applies every migration BEFORE this one, writes a
 * listing and a voucher under the old schema, applies this migration, and
 * proves the rows came through untouched with a NULL binding.
 */
describe("migration 20261022090000 over existing listings and vouchers", () => {
  const dbName = `yourtal_test_g28t1_${Math.random().toString(36).slice(2, 10)}`;
  const adminUrl = OWNER_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const targetUrl = OWNER_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  let target: pg.Client;

  const LISTING = "00000000-0000-4000-8000-0000000028a1";
  const LOCATION = "00000000-0000-4000-8000-0000000028a2";
  const VOUCHER = "00000000-0000-4000-8000-0000000028a3";
  const MERCHANT = "00000000-0000-4000-8000-0000000028f2";

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${dbName}" OWNER yourtal`);
    } finally {
      await admin.end();
    }
    target = new Client({ connectionString: targetUrl });
    await target.connect();
    // Only this throwaway database is built here, so durability is spent on
    // nothing: ~130 DDL commits otherwise dominate the run on a slow disk.
    await target.query("SET synchronous_commit = off");
    await target.query(readFileSync(bootstrapSql, "utf8"));

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files, "the migration under test must exist").toContain(THIS_MIGRATION);
    for (const file of files) {
      if (file >= THIS_MIGRATION) continue;
      await target.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  }, 240_000);

  afterAll(async () => {
    await target.end();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("adds the column without touching existing rows", async () => {
    await insert(target, listing(LISTING, { merchant_id: MERCHANT, channel: "both" }));
    await target.query(
      `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
       VALUES ($1, $2, 'Probe branch', '1 Probe St', 'Probe')`,
      [LOCATION, MERCHANT],
    );
    await target.query(
      `INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
      [LISTING, LOCATION],
    );
    await target.query(
      `INSERT INTO voucher.vouchers
         (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
          remaining_value_minor, partial_redemption_policy, transferable, issued_at,
          expires_at, location_id, state, currency, region)
       VALUES ($1, $2, $3, 'Probe merchant', 'Probe', 50000, 50000, 'single_use_forfeit',
               false, now(), now() + interval '30 days', $4, 'minted', 'IDR', 'ID')`,
      [VOUCHER, LISTING, MERCHANT, LOCATION],
    );

    const snapshot = async (): Promise<string> => {
      const listings = await target.query(
        `SELECT to_jsonb(l) - 'redeem_partner_id' AS row FROM store.listings l ORDER BY id`,
      );
      const vouchers = await target.query(
        `SELECT to_jsonb(v) AS row FROM voucher.vouchers v ORDER BY id`,
      );
      return JSON.stringify([listings.rows, vouchers.rows]);
    };

    const before = await snapshot();
    const beforeColumn = await target.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'store' AND table_name = 'listings'
          AND column_name = 'redeem_partner_id'`,
    );
    expect(beforeColumn.rowCount, "the column must not exist before the migration").toBe(0);

    await target.query(readFileSync(path.join(migrationsDir, THIS_MIGRATION), "utf8"));

    expect(await snapshot()).toBe(before);
    const { rows } = await target.query<{ redeem_partner_id: string | null }>(
      `SELECT redeem_partner_id FROM store.listings WHERE id = $1`,
      [LISTING],
    );
    expect(rows).toEqual([{ redeem_partner_id: null }]);
  }, 60_000);

  it("then enforces the bound shape on that same populated database", async () => {
    // Applying over existing rows must not have skipped the CHECK or the FK.
    await expect(
      target.query(`UPDATE store.listings SET redeem_partner_id = 'snap-app' WHERE id = $1`, [
        LISTING,
      ]),
    ).rejects.toThrow(/listings_bound_partner_shape/);
    await expect(
      target.query(
        `UPDATE store.listings SET channel = 'online', redeem_partner_id = 'nobody' WHERE id = $1`,
        [LISTING],
      ),
    ).rejects.toThrow(/listings_redeem_partner_id_fkey/);
    await target.query(
      `UPDATE store.listings SET channel = 'online', redeem_partner_id = 'snap-app' WHERE id = $1`,
      [LISTING],
    );
  });
});

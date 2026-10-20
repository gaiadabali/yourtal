import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { APP_URL, OWNER_URL } from "./database-urls";
import { postgresHandlers } from "./dsar-handlers";

/**
 * The `payment_cards` DSAR domain (5.1.d) against real Postgres: a deleted user's customer, saved
 * cards (live and replaced) and card-setup history are erased, a business's are not, and the app
 * role still holds no DELETE on them. Fixtures are written as the OWNER, the handler and
 * assertions run as the app (the split `dsar-handlers.test.ts` explains).
 */
const { Pool } = pg;
let pool: pg.Pool;
let owner: pg.Pool;
const subject = randomUUID();
const other = randomUUID();
const business = randomUUID();

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 2 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  for (const [kind, id] of [
    ["user", subject],
    ["user", other],
    ["business", business],
  ] as const) {
    await owner.query(
      `INSERT INTO payment.customer (owner_kind, owner_id, region, provider, customer_ref)
       VALUES ($1, $2, 'AU', 'stripe', $3)`,
      [kind, id, `cus_${id.slice(0, 8)}`],
    );
    // A replaced card and the live one: both are the person's.
    await owner.query(
      `INSERT INTO payment.saved_card (owner_kind, owner_id, region, provider, customer_ref,
         payment_method_ref, brand, last4, exp_month, exp_year, replaced_at)
       VALUES ($1, $2, 'AU', 'stripe', $3, $4, 'visa', '1111', 1, 2030, now()),
              ($1, $2, 'AU', 'stripe', $3, $5, 'visa', '4242', 12, 2034, NULL)`,
      [kind, id, `cus_${id.slice(0, 8)}`, `pm_old_${id.slice(0, 8)}`, `pm_${id.slice(0, 8)}`],
    );
    await owner.query(
      `INSERT INTO payment.card_setup (owner_kind, owner_id, region, provider, return_path)
       VALUES ($1, $2, 'AU', 'stripe', '/auctions')`,
      [kind, id],
    );
  }
});

afterAll(async () => {
  await owner.query(`DELETE FROM payment.saved_card WHERE owner_id = ANY($1::uuid[])`, [
    [subject, other, business],
  ]);
  await owner.query(`DELETE FROM payment.card_setup WHERE owner_id = ANY($1::uuid[])`, [
    [subject, other, business],
  ]);
  await owner.query(`DELETE FROM payment.customer WHERE owner_id = ANY($1::uuid[])`, [
    [subject, other, business],
  ]);
  await pool.end();
  await owner.end();
});

async function rowsFor(id: string): Promise<{ customers: number; cards: number; setups: number }> {
  const count = async (table: string): Promise<number> => {
    const { rows } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payment.${table} WHERE owner_id = $1`,
      [id],
    );
    return rows[0]?.n ?? 0;
  };
  return {
    customers: await count("customer"),
    cards: await count("saved_card"),
    setups: await count("card_setup"),
  };
}

describe("the payment_cards domain on account deletion", () => {
  it("cannot be done with the app's own grants: only the function can", async () => {
    await expect(
      pool.query(`DELETE FROM payment.saved_card WHERE owner_id = $1`, [subject]),
    ).rejects.toThrow(/permission denied/);
  });

  it("erases a user's customer, every card and the setup history, and touches no one else", async () => {
    const handler = postgresHandlers(pool)["payment_cards"];
    if (handler === undefined) throw new Error("payment_cards has no handler");

    // 1 customer + 2 cards + 1 setup.
    expect(await handler(subject)).toBe(4);
    expect(await rowsFor(subject)).toEqual({ customers: 0, cards: 0, setups: 0 });

    expect(await rowsFor(other)).toEqual({ customers: 1, cards: 2, setups: 1 });
    // A business owner with the same shape of row is not a user's data.
    expect(await handler(business)).toBe(0);
    expect(await rowsFor(business)).toEqual({ customers: 1, cards: 2, setups: 1 });

    // A retry finds nothing left to do, and is not an error.
    expect(await handler(subject)).toBe(0);
  });

  it("is reported as erased by a deletion request", async () => {
    const report = await executeDeletion(randomUUID(), postgresHandlers(pool));
    expect(report.results.find((result) => result.domain === "payment_cards")?.outcome).toEqual({
      status: "erased",
      records: 0,
    });
  });
});

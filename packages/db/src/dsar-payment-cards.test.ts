import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { APP_URL, OWNER_URL } from "./database-urls";
import { postgresHandlers } from "./dsar-handlers";
import { type PaymentCustomer, purgeDeletedAccountCustomers } from "./dsar-payment-handlers";

/**
 * The `payment_cards` DSAR domain (5.1.d) against real Postgres: a deleted user's customer, saved
 * cards (live and replaced) and card-setup history are erased, a business's are not, and the app
 * role still holds no DELETE on them. Fixtures are written as the OWNER, the handler and
 * assertions run as the app (the split `dsar-handlers.test.ts` explains).
 */
const { Pool } = pg;

/** The processor, as the tests see it: what it was asked to delete, and whether it is up. */
const deleted: PaymentCustomer[] = [];
let processorUp = true;
const deleteAtProcessor = (customer: PaymentCustomer): Promise<void> => {
  if (!processorUp) return Promise.reject(new Error("processor down"));
  deleted.push(customer);
  return Promise.resolve();
};
const handlers = () => postgresHandlers(pool, { deleteAtProcessor });
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
    const handler = handlers()["payment_cards"];
    if (handler === undefined) throw new Error("payment_cards has no handler");

    // 1 customer + 2 cards + 1 setup.
    expect(await handler(subject)).toBe(4);
    expect(await rowsFor(subject)).toEqual({ customers: 0, cards: 0, setups: 0 });
    // The processor was asked once, for the one customer the three kinds of row share.
    expect(deleted).toEqual([
      { provider: "stripe", region: "AU", customerRef: `cus_${subject.slice(0, 8)}` },
    ]);

    expect(await rowsFor(other)).toEqual({ customers: 1, cards: 2, setups: 1 });
    // A business owner with the same shape of row is not a user's data.
    expect(await handler(business)).toBe(0);
    expect(await rowsFor(business)).toEqual({ customers: 1, cards: 2, setups: 1 });

    // A retry finds nothing left to do, and is not an error.
    expect(await handler(subject)).toBe(0);
  });

  it("is reported as erased by a deletion request", async () => {
    const report = await executeDeletion(randomUUID(), handlers());
    expect(report.results.find((result) => result.domain === "payment_cards")?.outcome).toEqual({
      status: "erased",
      records: 0,
    });
  });
});

describe("the processor side of deleting a card (5.1.h)", () => {
  const down = randomUUID();
  const gone = randomUUID();

  async function seed(id: string): Promise<void> {
    await owner.query(
      `INSERT INTO payment.customer (owner_kind, owner_id, region, provider, customer_ref)
       VALUES ('user', $1, 'AU', 'stripe', $2)`,
      [id, `cus_${id.slice(0, 8)}`],
    );
    await owner.query(
      `INSERT INTO payment.saved_card (owner_kind, owner_id, region, provider, customer_ref,
         payment_method_ref, brand, last4, exp_month, exp_year)
       VALUES ('user', $1, 'AU', 'stripe', $2, $3, 'visa', '4242', 12, 2034)`,
      [id, `cus_${id.slice(0, 8)}`, `pm_${id.slice(0, 8)}`],
    );
  }

  afterAll(async () => {
    for (const table of ["saved_card", "customer"]) {
      await owner.query(`DELETE FROM payment.${table} WHERE owner_id = ANY($1::uuid[])`, [
        [down, gone],
      ]);
    }
  });

  it("keeps the rows, and reports the domain failed, when the processor is down", async () => {
    await seed(down);
    processorUp = false;
    deleted.length = 0;
    const report = await executeDeletion(down, handlers());
    expect(report.complete).toBe(false);
    const outcome = report.results.find((result) => result.domain === "payment_cards")?.outcome;
    expect(outcome?.status).toBe("failed");
    // The failure says what to do and carries no processor reference.
    expect(JSON.stringify(outcome)).toContain("retried");
    expect(JSON.stringify(outcome)).not.toContain(`cus_${down.slice(0, 8)}`);
    expect(deleted).toEqual([]);
    // The rows are the record a retry works from.
    expect(await rowsFor(down)).toEqual({ customers: 1, cards: 1, setups: 0 });
  });

  it("is retried for an account that no longer exists, and calls the processor once", async () => {
    // `down` has no identity.user_profile row, as after a deletion. The processor is still down.
    processorUp = false;
    // Other fixtures in this file also have no profile, so count at least ours.
    expect(
      (await purgeDeletedAccountCustomers(pool, deleteAtProcessor)).failed,
    ).toBeGreaterThanOrEqual(1);
    expect(await rowsFor(down)).toEqual({ customers: 1, cards: 1, setups: 0 });

    processorUp = true;
    deleted.length = 0;
    expect((await purgeDeletedAccountCustomers(pool, deleteAtProcessor)).failed).toBe(0);
    expect(deleted).toContainEqual({
      provider: "stripe",
      region: "AU",
      customerRef: `cus_${down.slice(0, 8)}`,
    });
    expect(deleted.filter((c) => c.customerRef === `cus_${down.slice(0, 8)}`)).toHaveLength(1);
    expect(await rowsFor(down)).toEqual({ customers: 0, cards: 0, setups: 0 });
  });

  it("leaves a live account's customer alone", async () => {
    const live = randomUUID();
    await seed(live);
    await owner.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Live', '1990-01-01', 'Australia/Sydney')`,
      [live],
    );
    try {
      deleted.length = 0;
      await purgeDeletedAccountCustomers(pool, deleteAtProcessor);
      expect(deleted.map((c) => c.customerRef)).not.toContain(`cus_${live.slice(0, 8)}`);
      expect(await rowsFor(live)).toEqual({ customers: 1, cards: 1, setups: 0 });
    } finally {
      await owner.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [live]);
      for (const table of ["saved_card", "customer"]) {
        await owner.query(`DELETE FROM payment.${table} WHERE owner_id = $1`, [live]);
      }
    }
  });

  it("without a processor to delete at, the domain is unhandled rather than quietly erased", async () => {
    await seed(gone);
    const report = await executeDeletion(gone, postgresHandlers(pool));
    expect(report.results.find((result) => result.domain === "payment_cards")?.outcome).toEqual({
      status: "unhandled",
      owner: "finance",
    });
    expect(await rowsFor(gone)).toEqual({ customers: 1, cards: 1, setups: 0 });
  });

  it("treats a customer the processor already deleted as done: the retry erases the rows", async () => {
    // The driver turns Stripe's 404 into success, so the deleter resolves; the rows then go.
    processorUp = true;
    const report = await executeDeletion(gone, handlers());
    expect(report.results.find((result) => result.domain === "payment_cards")?.outcome).toEqual({
      status: "erased",
      records: 2,
    });
  });
});

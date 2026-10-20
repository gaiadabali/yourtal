import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { purgeDeletedAccountCustomers } from "@yourtal/db/dsar-payment-handlers";
import {
  createPaymentProviders,
  processorCustomerDeleter,
} from "@yourtal/drivers/payment-providers";

/** Real Postgres, like the other worker job tests. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const OWNER_URL = process.env["DATABASE_OWNER_URL"];
if (OWNER_URL === undefined) throw new Error("DATABASE_OWNER_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });
const owner = new Pool({ connectionString: OWNER_URL });
const created: string[] = [];

afterAll(async () => {
  for (const table of ["saved_card", "customer"]) {
    await owner.query(`DELETE FROM payment.${table} WHERE owner_id = ANY($1::uuid[])`, [created]);
  }
  await pool.end();
  await owner.end();
});

async function customerOf(provider: "stripe" | "simulated"): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await owner.query(
    `INSERT INTO payment.customer (owner_kind, owner_id, region, provider, customer_ref)
     VALUES ('user', $1, 'AU', $2, $3)`,
    [id, provider, `cus_${id.slice(0, 8)}`],
  );
  return id;
}

async function rows(id: string): Promise<number> {
  const { rows: found } = await owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payment.customer WHERE owner_id = $1`,
    [id],
  );
  return found[0]?.n ?? 0;
}

describe("payment-customer-purge job (5.1.h)", () => {
  it("erases the rows of a deleted account once the processor has deleted the customer", async () => {
    const id = await customerOf("simulated");
    // The simulated processor holds nothing, so deleting there succeeds.
    await purgeDeletedAccountCustomers(pool, processorCustomerDeleter(createPaymentProviders({})));
    expect(await rows(id)).toBe(0);
  });

  it("keeps the rows of a Stripe customer it cannot reach, to try again next run", async () => {
    const id = await customerOf("stripe");
    // No Stripe driver here: the customer cannot be deleted, so its record stays.
    const result = await purgeDeletedAccountCustomers(
      pool,
      processorCustomerDeleter(createPaymentProviders({})),
    );
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await rows(id)).toBe(1);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, LEDGER_URL } from "./database-urls";

/**
 * YT-0518: the ledger's invariants, proved against a real Postgres.
 *
 * Every one of these could be asserted in a unit test against a service, and
 * every one of those assertions would be worthless. The claim in `docs/02`
 * §68 is that the ledger is double-entry and append-only **as a property of
 * the database** — so the thing that has to be true is that a connection
 * holding the ledger credential, with no service in the way, cannot write an
 * unbalanced transfer or edit a written one.
 *
 * These tests therefore connect as `yourtal_ledger` and `yourtal_app`
 * directly, not through any application code. They need `pnpm dev:up`.
 *
 * YT-0558: the two URLs used to be literals duplicated here, immune to any
 * environment override — exactly the shape `database-urls.ts`'s own header
 * comment describes as the reason it exists (six files once hard-coded the
 * same two strings). Pointing a dead host at this suite via `PGHOST_OVERRIDE`
 * had no effect on it; it would connect to whatever `pnpm dev:up` left
 * running regardless of what the environment said. Importing from
 * `database-urls.ts` gives this file the same `PGHOST_OVERRIDE`-first
 * resolution every other `packages/db` test already has, so sabotaging the
 * host is provable here too.
 */

const { Client } = pg;

let ledger: pg.Client;
let app: pg.Client;
let run = 0;

beforeAll(async () => {
  ledger = new Client({ connectionString: LEDGER_URL });
  app = new Client({ connectionString: APP_URL });
  await ledger.connect();
  await app.connect();
});

afterAll(async () => {
  await ledger.end();
  await app.end();
});

/** Unique per assertion, so a failure leaves behind evidence and not a clash. */
function ids() {
  run += 1;
  return {
    transfer: `led_txn_test_${String(run)}_${String(Date.now())}`,
    key: `idem_test_${String(run)}_${String(Date.now())}`,
  };
}

async function accountFor(currency: string): Promise<[string, string]> {
  const a = `acc_test_a_${String(Date.now())}_${String(run)}`;
  const b = `acc_test_b_${String(Date.now())}_${String(run)}`;
  for (const id of [a, b]) {
    // kind and country became NOT NULL with the chart of accounts (YT-0043):
    // an account with no classification is one no report can categorise.
    // `equity` is the neutral choice for a test account nobody has a claim on.
    await ledger.query(
      `INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
       VALUES ($1,'platform',$1,$2,'equity','ID')`,
      [id, currency],
    );
  }
  return [a, b];
}

describe("the balance invariant", () => {
  it("accepts a balanced transfer", async () => {
    const { transfer, key } = ids();
    const [from, to] = await accountFor("IDR");

    await ledger.query("BEGIN");
    await ledger.query(
      "INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1,$2,'test')",
      [transfer, key],
    );
    await ledger.query(
      `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
       VALUES ($1,$2,-1000,'IDR'), ($1,$3,1000,'IDR')`,
      [transfer, from, to],
    );
    await ledger.query("COMMIT");

    const { rows } = await ledger.query<{ sum: string }>(
      "SELECT COALESCE(SUM(amount_minor),0)::text AS sum FROM ledger.entry WHERE transfer_id = $1",
      [transfer],
    );
    expect(rows[0]?.sum).toBe("0");
  });

  it("REJECTS an unbalanced transfer at COMMIT", async () => {
    // The assertion this whole migration exists for. The inserts themselves
    // succeed — the trigger is DEFERRED, because a transfer is legitimately
    // built from several statements — and the transaction dies at COMMIT.
    const { transfer, key } = ids();
    const [from, to] = await accountFor("IDR");

    await ledger.query("BEGIN");
    await ledger.query(
      "INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1,$2,'test')",
      [transfer, key],
    );
    await ledger.query(
      `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
       VALUES ($1,$2,-1000,'IDR'), ($1,$3,999,'IDR')`,
      [transfer, from, to],
    );

    await expect(ledger.query("COMMIT")).rejects.toThrow(/unbalanced by/);
    await ledger.query("ROLLBACK").catch(() => undefined);

    const { rows } = await ledger.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM ledger.transfer WHERE id = $1",
      [transfer],
    );
    expect(rows[0]?.count, "the whole transfer must be gone, not just the entries").toBe("0");
  });

  it("REJECTS a single-entry transfer", async () => {
    // One entry can be "balanced" only by being zero, and a zero entry is
    // separately rejected. Double-entry means at least two sides.
    const { transfer, key } = ids();
    const [from] = await accountFor("IDR");

    await ledger.query("BEGIN");
    await ledger.query(
      "INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1,$2,'test')",
      [transfer, key],
    );
    await ledger.query(
      "INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency) VALUES ($1,$2,-1000,'IDR')",
      [transfer, from],
    );

    await expect(ledger.query("COMMIT")).rejects.toThrow(/double-entry needs at least 2/);
    await ledger.query("ROLLBACK").catch(() => undefined);
  });

  it("REJECTS a zero-amount entry immediately", async () => {
    const { transfer, key } = ids();
    const [from] = await accountFor("IDR");

    await ledger.query("BEGIN");
    await ledger.query(
      "INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1,$2,'test')",
      [transfer, key],
    );
    await expect(
      ledger.query(
        "INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency) VALUES ($1,$2,0,'IDR')",
        [transfer, from],
      ),
    ).rejects.toThrow(/entry_amount_nonzero/);
    await ledger.query("ROLLBACK");
  });
});

describe("idempotency", () => {
  it("REJECTS a replayed idempotency key", async () => {
    // docs/02 line 225. This one constraint is the whole retry story: a
    // replayed transfer cannot create a second movement of value.
    const { transfer, key } = ids();
    const [from, to] = await accountFor("IDR");

    const write = async (transferId: string) => {
      await ledger.query("BEGIN");
      await ledger.query(
        "INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ($1,$2,'test')",
        [transferId, key],
      );
      await ledger.query(
        `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
         VALUES ($1,$2,-500,'IDR'), ($1,$3,500,'IDR')`,
        [transferId, from, to],
      );
      await ledger.query("COMMIT");
    };

    await write(transfer);
    await expect(write(`${transfer}_again`)).rejects.toThrow(/idempotency_key/);
    await ledger.query("ROLLBACK").catch(() => undefined);
  });
});

describe("append-only, by grant rather than by convention", () => {
  it("does not let the ledger role UPDATE an entry", async () => {
    // docs/14 §8: "the ledger role holds no UPDATE or DELETE on transfer".
    // A ledger you can edit is a spreadsheet.
    await expect(
      ledger.query("UPDATE ledger.entry SET amount_minor = 1 WHERE true"),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let the ledger role DELETE an entry", async () => {
    await expect(ledger.query("DELETE FROM ledger.entry WHERE true")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("does not let the ledger role DELETE a transfer", async () => {
    await expect(ledger.query("DELETE FROM ledger.transfer WHERE true")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("module isolation", () => {
  it("does not let the app role read the ledger at all", async () => {
    // docs/13: module boundaries enforced twice. A cross-module table read
    // fails as a permission error in development rather than as a surprise
    // in production — the app asks the ledger service, never its tables.
    await expect(app.query("SELECT 1 FROM ledger.entry LIMIT 1")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("lets the app role use its own idempotency table", async () => {
    const { key } = ids();
    await app.query(
      `INSERT INTO platform.idempotency (scope, key, fingerprint, state, expires_at)
       VALUES ($1, $2, repeat('a', 64), 'in_progress', now() + interval '1 day')`,
      ["tenant:test", key],
    );

    const { rows } = await app.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM platform.idempotency WHERE key = $1",
      [key],
    );
    expect(rows[0]?.count).toBe("1");
  });
});

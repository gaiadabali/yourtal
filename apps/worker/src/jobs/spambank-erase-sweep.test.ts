import { err, ok } from "neverthrow";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSimulatedSpambank } from "@yourtal/drivers/spambank";
import type { SpambankDriver, SpambankFailure } from "@yourtal/drivers/spambank";
import { sweepErasingMailboxes } from "./spambank-erase-sweep";

/**
 * The deletion sweep (spambank/BUILD.md 4.11) against real Postgres and a driver that records what it
 * was asked to destroy: an `erasing` mailbox's account is destroyed and its row removed, a Stalwart
 * that is down delays it without losing it, and a mailbox of an account that is gone is erased too.
 */

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
const OWNER_URL = process.env["DATABASE_OWNER_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
if (OWNER_URL === undefined) throw new Error("DATABASE_OWNER_URL must be set");

const RUN = Date.now().toString(36);
const toLetters = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "a");
const nameOf = (n: number): string =>
  `sw${toLetters(RUN)}${toLetters(String(n + 1000))}`.slice(0, 16);

let pool: Pool;
let owner: Pool;
const users: string[] = [];
const names: string[] = [];
let counter = 0;

async function mailbox(options: {
  status: "active" | "erasing" | "provisioning";
  account: string | null;
  profile?: boolean;
  old?: boolean;
}): Promise<{ id: string; userId: string; localPart: string }> {
  counter += 1;
  const userId = `sweep-${RUN}-${String(counter)}`;
  const localPart = nameOf(counter);
  users.push(userId);
  names.push(localPart);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via, stalwart_account_id, created_at)
     VALUES ($1, 'AU', $2, 'yourtal.gaiada.com', $3, 'yourtal', $4,
             now() - ($5::int * interval '1 minute'))
     RETURNING id`,
    [userId, localPart, options.status, options.account, options.old === false ? 0 : 60],
  );
  if (options.profile === true) {
    await owner.query(
      `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
       VALUES ($1, 'AU', 'Sweep Test', '1990-01-01', 'Australia/Sydney')`,
      [userId],
    );
  }
  return { id: rows[0]!.id, userId, localPart };
}

const exists = async (id: string): Promise<boolean> =>
  (await pool.query(`SELECT 1 FROM spambank.mailbox WHERE id = $1`, [id])).rowCount === 1;

/** A driver that records the accounts it was told to destroy, and can be told to fail. */
function recordingDriver(failWith?: SpambankFailure) {
  const destroyed: string[] = [];
  const base = createSimulatedSpambank({ domains: ["yourtal.gaiada.com"] });
  const driver: SpambankDriver = {
    ...base,
    destroyAccount(accountId) {
      if (failWith !== undefined) return Promise.resolve(err(failWith));
      destroyed.push(accountId);
      return Promise.resolve(ok(undefined));
    },
  };
  return { driver, destroyed };
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL });
  owner = new Pool({ connectionString: OWNER_URL });
});

afterAll(async () => {
  await owner.query(`DELETE FROM identity.user_profile WHERE user_id = ANY($1)`, [users]);
  await owner.query(`DELETE FROM spambank.mailbox WHERE user_id = ANY($1)`, [users]);
  await owner.query(`DELETE FROM spambank.retired_name WHERE local_part = ANY($1)`, [names]);
  await pool.end();
  await owner.end();
});

describe("spambank-erase-sweep", () => {
  it("destroys an erasing mailbox's account and removes its row, and leaves the active ones alone", async () => {
    const gone = await mailbox({ status: "erasing", account: `acct-${RUN}-gone` });
    const keep = await mailbox({ status: "active", account: `acct-${RUN}-keep`, profile: true });
    const { driver, destroyed } = recordingDriver();

    const result = await sweepErasingMailboxes(pool, driver);

    expect(result.erased).toBeGreaterThanOrEqual(1);
    expect(destroyed).toContain(`acct-${RUN}-gone`);
    expect(destroyed).not.toContain(`acct-${RUN}-keep`);
    expect(await exists(gone.id)).toBe(false);
    expect(await exists(keep.id)).toBe(true);
  });

  it("keeps the row when Stalwart will not destroy the account, and finishes on the next run", async () => {
    const stuck = await mailbox({ status: "erasing", account: `acct-${RUN}-stuck` });
    const failure: SpambankFailure = {
      kind: "server_error",
      boundary: "spambank",
      detail: "down",
      mayHaveSucceeded: false,
      code: "unavailable",
    };
    const logged: string[] = [];

    const first = await sweepErasingMailboxes(pool, recordingDriver(failure).driver, (line) => {
      logged.push(line);
    });
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await exists(stuck.id)).toBe(true);
    // The log names the mailbox id and the code, never the address or an account secret.
    expect(logged.join("\n")).toContain(stuck.id);
    expect(logged.join("\n")).not.toContain(stuck.localPart);

    const { driver, destroyed } = recordingDriver();
    await sweepErasingMailboxes(pool, driver);
    expect(destroyed).toContain(`acct-${RUN}-stuck`);
    expect(await exists(stuck.id)).toBe(false);
  });

  it("removes the row of an erasing mailbox that never reached Stalwart", async () => {
    const never = await mailbox({ status: "erasing", account: null });
    const { driver, destroyed } = recordingDriver();
    await sweepErasingMailboxes(pool, driver);
    expect(destroyed).toEqual([]);
    expect(await exists(never.id)).toBe(false);
  });

  it("erases, retires and destroys the mailbox of an account that is gone, but not a fresh one", async () => {
    const orphan = await mailbox({ status: "active", account: `acct-${RUN}-orphan` });
    const fresh = await mailbox({
      status: "provisioning",
      account: null,
      old: false,
    });
    const { driver, destroyed } = recordingDriver();

    const first = await sweepErasingMailboxes(pool, driver);
    expect(first.orphans).toBeGreaterThanOrEqual(1);
    // Marked erasing and retired by the first pass, destroyed by the second pass of the same run
    // only if it was picked up in time; either way the next run finishes it.
    await sweepErasingMailboxes(pool, driver);
    expect(destroyed).toContain(`acct-${RUN}-orphan`);
    expect(await exists(orphan.id)).toBe(false);
    const retired = await pool.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      orphan.localPart,
    ]);
    expect(retired.rowCount).toBe(1);
    // A mailbox created in the last minutes may simply be mid-provisioning: left alone.
    expect(await exists(fresh.id)).toBe(true);
  });
});

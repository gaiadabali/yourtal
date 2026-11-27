import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapappReceiver } from "@yourtal/contracts/spambank/events";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { newsletterFrom } from "../classify/fixtures/sender-fixtures";
import type { IngestDeps } from "./ingest-mailbox";
import { activeMailboxIds, reconcileMailboxes } from "./reconcile";
import {
  CLASSIFY,
  account,
  deleteMailboxes,
  failure,
  fakeDriver,
  insertMailbox,
  rawEmail,
  testPool,
} from "./test-support";

/** BUILD.md B5: the 1-minute reconcile makes the webhook non-critical. */

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

function deps(driver: SpambankDriver): IngestDeps {
  return {
    pool,
    driver,
    classify: CLASSIFY,
    autoreplyMode: "dry_run",
    receiver: snapappReceiver("staging"),
    log: () => undefined,
  };
}

async function mailboxes(count: number, over: Parameters<typeof insertMailbox>[1] = {}) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const row = await insertMailbox(pool, over);
    made.push(row.id);
    rows.push(row);
  }
  return rows;
}

describe("the reconcile", () => {
  it("reads every active mailbox and none that is not", async () => {
    const domain = `rec${Date.now().toString(36)}.t6test`;
    const [a, b] = await mailboxes(2);
    const [suspended] = await mailboxes(1, { status: "suspended" });
    const script = account({
      changes: { s0: { created: ["r1"], newState: "s1" } },
      emails: {
        r1: rawEmail({ id: "r1", in: ["junk"], sender: newsletterFrom(`n@${domain}`, domain) }),
      },
    });
    const result = await reconcileMailboxes(deps(fakeDriver(script)));
    expect(result.mailboxes).toBeGreaterThanOrEqual(2);
    expect(result.stalwartDown).toBe(false);
    const seen = await pool.query<{ mailbox_id: string }>(
      "SELECT mailbox_id FROM spambank.ingested_message WHERE email_id = 'r1' AND mailbox_id = ANY($1::uuid[])",
      [[a?.id, b?.id, suspended?.id]],
    );
    expect(seen.rows.map((r) => r.mailbox_id).sort()).toEqual([a?.id, b?.id].sort());
    expect(await activeMailboxIds(pool)).not.toContain(suspended?.id);
  });

  it("a webhook that never fires: a delivered message is processed by the next reconcile", async () => {
    const domain = `nohook${Date.now().toString(36)}.t6test`;
    const [box] = await mailboxes(1);
    const script = account({
      changes: { s0: { created: ["w1"], newState: "s1" } },
      emails: { w1: rawEmail({ id: "w1", sender: newsletterFrom(`n@${domain}`, domain) }) },
    });
    const result = await reconcileMailboxes(deps(fakeDriver(script)));
    expect(result.processed).toBeGreaterThanOrEqual(1);
    const row = await pool.query(
      "SELECT 1 FROM spambank.ingested_message WHERE mailbox_id = $1 AND email_id = 'w1'",
      [box?.id],
    );
    expect(row.rowCount).toBe(1);
    expect(result.autoreplies).toContainEqual({ mailboxId: box?.id, emailId: "w1" });
  });

  it("stops early when Stalwart answers nothing for several mailboxes in a row", async () => {
    await mailboxes(6);
    const result = await reconcileMailboxes(
      deps(fakeDriver(account({ down: failure("unavailable") }))),
      {
        concurrency: 1,
      },
    );
    expect(result.stalwartDown).toBe(true);
    expect(result.mailboxes).toBeLessThan((await activeMailboxIds(pool)).length);
  });

  it("respects its time budget", async () => {
    await mailboxes(3);
    const result = await reconcileMailboxes(deps(fakeDriver(account())), { budgetMs: 0 });
    expect(result.mailboxes).toBe(0);
  });
});

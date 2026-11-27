import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { createPgMailStore } from "./mail-store";
import type { SpambankMailStore } from "./mail-store";

/**
 * The mail API's Postgres store (spambank/BUILD.md §4.3 send cap, §4.5 unsubscribe rows, §4.13
 * counters) as the app role, so a missing grant fails here. Rows are keyed by a run token.
 */

const RUN = Date.now().toString(36);
const letters = (text: string): string =>
  text.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "a");

let pool: pg.Pool;
let store: SpambankMailStore;
const created: string[] = [];

async function mailbox(n: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via, junk_mailbox_id)
     VALUES ($1, 'AU', $2, 'yourtal.gaiada.com', 'active', 'snapapp', 'mbjunk') RETURNING id`,
    [`sbt5-${RUN}-${String(n)}`, `sbt${letters(RUN)}${letters(String(n + 100))}`.slice(0, 16)],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no mailbox");
  created.push(id);
  return id;
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 4 });
  store = createPgMailStore(createAppDb(process.env["DATABASE_URL"] ?? ""));
});

afterAll(async () => {
  if (created.length > 0)
    await pool.query("DELETE FROM spambank.mailbox WHERE id = ANY($1::uuid[])", [created]);
  await pool.end();
});

describe("createPgMailStore", () => {
  it("finds a mailbox by id, and nothing for an unknown or malformed id", async () => {
    const id = await mailbox(1);
    expect(await store.findMailbox(id)).toMatchObject({
      id,
      status: "active",
      domain: "yourtal.gaiada.com",
      junkMailboxId: "mbjunk",
    });
    expect(await store.findMailbox(randomUUID())).toBeUndefined();
    expect(await store.findMailbox("not-a-uuid")).toBeUndefined();
  });

  it("counts recipients up to the cap, atomically, and gives them back", async () => {
    const id = await mailbox(2);
    const day = await store.reserveRecipients(id, 60, 100);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await store.reserveRecipients(id, 41, 100)).toBeUndefined();
    // Fifty parallel single sends against the 40 left: exactly 40 win.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => store.reserveRecipients(id, 1, 100)),
    );
    expect(results.filter((r) => r !== undefined)).toHaveLength(40);
    await store.releaseRecipients(id, day ?? "", 5);
    expect(await store.reserveRecipients(id, 5, 100)).toBe(day);
    expect(await store.reserveRecipients(id, 1, 100)).toBeUndefined();
  });

  it("records unsubscribes and reads the counters", async () => {
    const id = await mailbox(3);
    await store.recordUnsubscribe({
      mailboxId: id,
      orgDomain: "shop.example",
      method: "one_click",
      status: "done",
      httpStatus: 200,
    });
    await store.recordUnsubscribe({
      mailboxId: id,
      orgDomain: "shop.example",
      method: "mailto",
      status: "done",
      httpStatus: null,
    });
    await store.recordUnsubscribe({
      mailboxId: id,
      orgDomain: "other.example",
      method: "one_click",
      status: "failed",
      httpStatus: 500,
    });
    await pool.query(
      `INSERT INTO spambank.ingested_message (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, autoreply_decision)
       VALUES ($1, 'e1', now(), 'junk', true, true, 'not_bulk'), ($1, 'e2', now(), 'inbox', false, true, 'not_bulk'),
              ($1, 'e3', now() - interval '40 days', 'junk', true, true, 'not_bulk')`,
      [id],
    );
    expect(await store.counters(id)).toEqual({
      bulkFiled30d: 1,
      marketersUnsubscribed: 1,
      autoRepliesSent30d: 0,
    });
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapappReceiver } from "@yourtal/contracts/spambank/events";
import { newsletterFrom } from "../classify/fixtures/sender-fixtures";
import { ingestMailbox } from "./ingest-mailbox";
import type { IngestDeps } from "./ingest-mailbox";
import type { Account, MailboxFixture } from "./test-support";
import {
  CLASSIFY,
  account,
  deleteMailboxes,
  failure,
  fakeDriver,
  insertMailbox,
  linkSnapapp,
  mailboxList,
  rawEmail,
  testPool,
} from "./test-support";

/**
 * One mailbox's read, against real Postgres and a scripted Stalwart (BUILD.md F3, B5): what `Email/changes`
 * leads to, what is saved, and what happens when Stalwart or the state goes away.
 */

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

async function mailbox(over: Parameters<typeof insertMailbox>[1] = {}): Promise<MailboxFixture> {
  const row = await insertMailbox(pool, over);
  made.push(row.id);
  return row;
}

function deps(script: Account, over: Partial<IngestDeps> = {}): IngestDeps {
  return {
    pool,
    driver: fakeDriver(script),
    classify: CLASSIFY,
    autoreplyMode: "dry_run",
    receiver: snapappReceiver("staging"),
    log: () => undefined,
    ...over,
  };
}

const brand = (n: string) => `${n}${Date.now().toString(36)}.t6test`;

async function state(box: MailboxFixture): Promise<string | null> {
  const { rows } = await pool.query<{ email_state: string | null }>(
    "SELECT email_state FROM spambank.mailbox WHERE id = $1",
    [box.id],
  );
  return rows[0]?.email_state ?? null;
}

describe("reading new mail", () => {
  it("lists the created ids, records each message, and saves the new state", async () => {
    const domain = brand("flow");
    const box = await mailbox({ emailState: "s0" });
    const script = account({
      changes: { s0: { created: ["m1", "m2"], newState: "s1" } },
      emails: {
        m1: rawEmail({ id: "m1", in: ["junk"], sender: newsletterFrom(`news@${domain}`, domain) }),
        m2: rawEmail({ id: "m2", in: ["spam"], sender: newsletterFrom(`promo@${domain}`, domain) }),
      },
    });
    const result = await ingestMailbox(deps(script), box.id);
    expect(result).toMatchObject({ status: "ok", processed: 2, autoreplyEmailIds: ["m1"] });
    expect(await state(box)).toBe("s1");
    const rows = await pool.query<{ email_id: string; folder: string }>(
      "SELECT email_id, folder FROM spambank.ingested_message WHERE mailbox_id = $1 ORDER BY email_id",
      [box.id],
    );
    expect(rows.rows).toEqual([
      { email_id: "m1", folder: "junk" },
      { email_id: "m2", folder: "spam" },
    ]);
    // The Email/get asks for the :all header forms (BUILD.md 7.1), never the last-instance-only forms.
    const get = script.requests
      .flatMap((request) => request.methodCalls)
      .find(([name]) => name === "Email/get");
    const properties = (get?.[1]["properties"] ?? []) as string[];
    expect(properties).toContain("header:Authentication-Results:asText:all");
    expect(properties).not.toContain("header:Authentication-Results:asText");
  });

  it("an empty change (an update only) still moves the state", async () => {
    const box = await mailbox({ emailState: "s0" });
    const script = account({ changes: { s0: { created: [], newState: "s9" } } });
    expect(await ingestMailbox(deps(script), box.id)).toMatchObject({ status: "ok", processed: 0 });
    expect(await state(box)).toBe("s9");
  });

  it("follows hasMoreChanges across pages", async () => {
    const domain = brand("pages");
    const box = await mailbox({ emailState: "s0" });
    const script = account({
      changes: {
        s0: { created: ["p1"], newState: "s1", hasMore: true },
        s1: { created: ["p2"], newState: "s2" },
      },
      emails: {
        p1: rawEmail({ id: "p1", sender: newsletterFrom(`a@${domain}`, domain) }),
        p2: rawEmail({ id: "p2", sender: newsletterFrom(`b@${domain}`, domain) }),
      },
    });
    expect(await ingestMailbox(deps(script), box.id)).toMatchObject({ processed: 2 });
    expect(await state(box)).toBe("s2");
  });

  it("a state Stalwart cannot continue from: a fresh state and the last 48 hours, each message once", async () => {
    const domain = brand("lost");
    const box = await mailbox({ emailState: "old" });
    const script = account({
      state: "fresh",
      recent: ["r1"],
      emails: { r1: rawEmail({ id: "r1", sender: newsletterFrom(`a@${domain}`, domain) }) },
    });
    expect(await ingestMailbox(deps(script), box.id)).toMatchObject({ status: "ok", processed: 1 });
    expect(await state(box)).toBe("fresh");
    // A second resync re-reads the same message and records nothing new.
    await pool.query("UPDATE spambank.mailbox SET email_state = 'old' WHERE id = $1", [box.id]);
    expect(await ingestMailbox(deps(script), box.id)).toMatchObject({ status: "ok", processed: 0 });
  });

  it("starts from the current state when provisioning recorded none, and reads nothing from before", async () => {
    const box = await mailbox({ emailState: null });
    const script = account({ state: "now" });
    expect(await ingestMailbox(deps(script), box.id)).toMatchObject({ status: "ok", processed: 0 });
    expect(await state(box)).toBe("now");
  });
});

describe("when something is not right", () => {
  it("Stalwart down: unavailable, nothing recorded, the state does not move", async () => {
    const box = await mailbox({ emailState: "s0" });
    const script = account({ down: failure("unavailable") });
    const result = await ingestMailbox(deps(script), box.id);
    expect(result).toMatchObject({ status: "unavailable", detail: "unavailable", processed: 0 });
    expect(await state(box)).toBe("s0");
  });

  it("our credential refused is reported as upstream_auth", async () => {
    const box = await mailbox();
    const lines: string[] = [];
    const result = await ingestMailbox(
      deps(account({ down: failure("upstream_auth") }), { log: (line) => lines.push(line) }),
      box.id,
    );
    expect(result).toMatchObject({ status: "unavailable", detail: "upstream_auth" });
    expect(lines.join("\n")).toContain("upstream_auth");
  });

  it("skips a mailbox that is not active, or does not exist", async () => {
    const suspended = await mailbox({ status: "suspended" });
    const erasing = await mailbox({ status: "erasing" });
    const script = account();
    expect(await ingestMailbox(deps(script), suspended.id)).toMatchObject({ status: "skipped" });
    expect(await ingestMailbox(deps(script), erasing.id)).toMatchObject({ status: "skipped" });
    expect(await ingestMailbox(deps(script), "00000000-0000-4000-8000-000000000000")).toMatchObject(
      { status: "skipped", detail: "no_mailbox" },
    );
    expect(script.requests).toHaveLength(0);
  });

  it("two runs for one mailbox: one reads, the other leaves it", async () => {
    const domain = brand("lock");
    const box = await mailbox({ emailState: "s0" });
    const script = account({
      changes: { s0: { created: ["l1"], newState: "s1" } },
      emails: { l1: rawEmail({ id: "l1", sender: newsletterFrom(`a@${domain}`, domain) }) },
    });
    const results = await Promise.all([
      ingestMailbox(deps(script), box.id),
      ingestMailbox(deps(script), box.id),
      ingestMailbox(deps(script), box.id),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain("ok");
    expect(results.reduce((sum, r) => sum + r.processed, 0)).toBe(1);
    // The lock is released: the next run takes it.
    expect((await ingestMailbox(deps(script), box.id)).status).toBe("ok");
  });

  it("a message that cannot be recorded is skipped, and the rest are read", async () => {
    const domain = brand("bad");
    const box = await mailbox({ emailState: "s0" });
    const good = rawEmail({ id: "g1", sender: newsletterFrom(`a@${domain}`, domain) });
    // A data error Postgres refuses (a NUL byte in a text value, class 22), not a connection problem.
    const badId = "bad\u0000id";
    const bad = rawEmail({ id: badId, sender: newsletterFrom(`b@${domain}`, domain) });
    const lines: string[] = [];
    const script = account({
      changes: { s0: { created: [badId, "g1"], newState: "s1" } },
      emails: { [badId]: bad, g1: good },
    });
    const result = await ingestMailbox(deps(script, { log: (line) => lines.push(line) }), box.id);
    expect(result.status).toBe("ok");
    expect(lines.join(" ")).toContain("skipped one message");
    expect(await state(box)).toBe("s1");
    const ids = await pool.query<{ email_id: string }>(
      "SELECT email_id FROM spambank.ingested_message WHERE mailbox_id = $1",
      [box.id],
    );
    expect(ids.rows.map((r) => r.email_id)).toContain("g1");
  });
});

describe("the new-mail alert (§4.9)", () => {
  const SECTOR = "snapapp-staging";

  function twoInbox(prefix: string): Account {
    const domain = brand(prefix);
    return account({
      mailboxes: mailboxList(3),
      changes: { s0: { created: [`${prefix}1`], newState: "s1" } },
      emails: {
        [`${prefix}1`]: rawEmail({
          id: `${prefix}1`,
          in: ["inbox"],
          sender: newsletterFrom(`news@${domain}`, domain),
        }),
      },
    });
  }

  async function events(sub: string) {
    const { rows } = await pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
      expires_at: Date;
      iat: Date;
    }>(
      "SELECT event_type, payload, expires_at, iat FROM spambank.app_event_outbox WHERE sub = $1 ORDER BY iat",
      [sub],
    );
    return rows;
  }

  it("a new Inbox message: one event with the unread count, 15 minutes to live", async () => {
    const box = await mailbox({ emailState: "s0" });
    const sub = await linkSnapapp(pool, box.user_id, SECTOR);
    const result = await ingestMailbox(deps(twoInbox("al1")), box.id);
    expect(result.eventsQueued).toBe(1);
    const rows = await events(sub);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ "urn:yourtal:event:spambank-mail": { unread_inbox: 3 } });
    expect(((rows[0]?.expires_at.getTime() ?? 0) - (rows[0]?.iat.getTime() ?? 0)) / 60_000).toBe(
      15,
    );
  });

  it("a second mail inside 2 minutes sends no second event", async () => {
    const box = await mailbox({ emailState: "s0" });
    const sub = await linkSnapapp(pool, box.user_id, SECTOR);
    await ingestMailbox(deps(twoInbox("al2")), box.id);
    await pool.query("UPDATE spambank.mailbox SET email_state = 's0' WHERE id = $1", [box.id]);
    const second = twoInbox("al2b");
    second.changes = { s0: { created: ["al2b1"], newState: "s2" } };
    await ingestMailbox(deps(second), box.id);
    expect(await events(sub)).toHaveLength(1);
    // After the 2 minutes the next one is alerted again.
    await pool.query(
      "UPDATE spambank.mailbox SET email_state = 's0', last_alert_at = now() - interval '3 minutes' WHERE id = $1",
      [box.id],
    );
    const third = twoInbox("al2c");
    third.changes = { s0: { created: ["al2c1"], newState: "s3" } };
    await ingestMailbox(deps(third), box.id);
    expect(await events(sub)).toHaveLength(2);
  });

  it("nothing is sent with alerts off, without a SnapApp link, after the person left SnapApp, or for Junk", async () => {
    const off = await mailbox({ emailState: "s0", alerts: false });
    const offSub = await linkSnapapp(pool, off.user_id, SECTOR);
    await ingestMailbox(deps(twoInbox("al3")), off.id);
    expect(await events(offSub)).toHaveLength(0);

    const unlinked = await mailbox({ emailState: "s0" });
    expect((await ingestMailbox(deps(twoInbox("al4")), unlinked.id)).eventsQueued).toBe(0);

    const left = await mailbox({ emailState: "s0" });
    const leftSub = await linkSnapapp(pool, left.user_id, SECTOR, { ended: true });
    await ingestMailbox(deps(twoInbox("al5")), left.id);
    expect(await events(leftSub)).toHaveLength(0);

    const junk = await mailbox({ emailState: "s0" });
    const junkSub = await linkSnapapp(pool, junk.user_id, SECTOR);
    const domain = brand("al6");
    const junkOnly = account({
      changes: { s0: { created: ["j1"], newState: "s1" } },
      emails: {
        j1: rawEmail({ id: "j1", in: ["junk"], sender: newsletterFrom(`n@${domain}`, domain) }),
      },
    });
    await ingestMailbox(deps(junkOnly), junk.id);
    expect(await events(junkSub)).toHaveLength(0);
  });

  it("an old message surfaced by a resync is not an alert", async () => {
    const box = await mailbox({ emailState: "stale" });
    const sub = await linkSnapapp(pool, box.user_id, SECTOR);
    const domain = brand("al7");
    const script = account({
      state: "fresh",
      recent: ["o1"],
      emails: {
        o1: rawEmail({
          id: "o1",
          receivedAt: new Date(Date.now() - 30 * 3600_000),
          sender: newsletterFrom(`n@${domain}`, domain),
        }),
      },
    });
    await ingestMailbox(deps(script), box.id);
    expect(await events(sub)).toHaveLength(0);
  });
});

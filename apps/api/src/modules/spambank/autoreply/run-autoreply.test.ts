import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import { OWNER_URL } from "../../../../../../packages/db/src/database-urls";
import { newsletterFrom } from "../classify/fixtures/sender-fixtures";
import {
  CLASSIFY,
  RUN,
  account,
  deleteMailboxes,
  failure,
  fakeDriver,
  insertMailbox,
  rawEmail,
  testPool,
} from "../ingest/test-support";
import type { Account, MailboxFixture } from "../ingest/test-support";
import type { SendOutcome, SystemMailer } from "./mailer";
import { runAutoreply } from "./run-autoreply";
import type { AutoreplyDeps } from "./run-autoreply";
import { sweepAutoreplies } from "./sweep";

/**
 * BUILD.md §4.6 against the real schema: every decision the job can take, the atomic claims (one reply per
 * domain per 30 days, the daily cap), the modes, and the race the card names (20 jobs, one domain, exactly
 * one reply). Each test runs on its own far-future UTC day so `autoreply_day` never meets a real one.
 */

const KEY = "k".repeat(43);
let pool: Pool;
let owner: Pool;
const mailboxes: string[] = [];
const domains: string[] = [];
const days: string[] = [];
let saved: Record<string, unknown> | undefined;
let dayOffset = 0;
let domainCounter = 0;

class FakeMailer implements SystemMailer {
  readonly fromAddress = "reply@spambank.yourtal.gaiada.com";
  readonly sent: { raw: string; to: readonly string[] }[] = [];
  fail: SendOutcome | null = null;
  prepareFails = false;
  prepare(): Promise<void> {
    return this.prepareFails ? Promise.reject(new Error("down")) : Promise.resolve();
  }
  send(raw: string, to: readonly string[]): Promise<SendOutcome> {
    if (this.fail !== null) return Promise.resolve(this.fail);
    this.sent.push({ raw, to });
    return Promise.resolve({ ok: true, emailId: `E${String(this.sent.length)}` });
  }
}

function freshDomain(): string {
  domainCounter += 1;
  const domain = `t7${RUN}x${String(domainCounter)}.com.au`;
  domains.push(domain);
  return domain;
}

/** A UTC noon on a day nobody else uses. */
function freshNow(): Date {
  dayOffset += 1;
  const now = new Date(
    Date.UTC(2091, 0, 1, 12) +
      (Number.parseInt(RUN.slice(-3), 36) % 200) * 86_400_000 * 10 +
      dayOffset * 86_400_000,
  );
  days.push(now.toISOString().slice(0, 10));
  return now;
}

interface World {
  readonly box: MailboxFixture;
  readonly script: Account;
  readonly mailer: FakeMailer;
  readonly now: Date;
  deps(mode: AutoreplyMode, over?: Partial<AutoreplyDeps>): AutoreplyDeps;
  /** A message in the mailbox, recorded by ingest as `queued`. */
  message(
    from: string,
    options?: { folder?: string; receivedAt?: Date; sender?: object },
  ): Promise<string>;
}

async function world(): Promise<World> {
  const box = await insertMailbox(pool);
  mailboxes.push(box.id);
  const script = account();
  const mailer = new FakeMailer();
  const now = freshNow();
  const driver = fakeDriver(script);
  return {
    box,
    script,
    mailer,
    now,
    deps: (mode, over = {}) => ({
      pool,
      driver,
      mailer,
      classify: CLASSIFY,
      settings: {
        mode,
        redirectTo: "tester@gmail.com",
        replyDomain: "spambank.yourtal.gaiada.com",
        optoutKey: KEY,
        publicOrigin: "https://yourtal.gaiada.com",
        abn: null,
        contactEmail: "hello@god.gaiada.com",
      },
      now: () => now,
      log: () => undefined,
      ...over,
    }),
    async message(from, options = {}) {
      const id = `M${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const receivedAt = options.receivedAt ?? new Date(now.getTime() - 60_000);
      script.emails[id] = {
        ...rawEmail({
          id,
          in: [options.folder ?? "junk"],
          receivedAt,
          sender: options.sender ?? newsletterFrom(from),
        }),
        messageId: [`${id}@mail.example`],
        references: [],
      };
      await pool.query(
        `INSERT INTO spambank.ingested_message
           (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, from_org_domain, autoreply_decision, processed_at)
         VALUES ($1, $2, $3, 'junk', true, true, NULL, 'queued', $4)`,
        [box.id, id, receivedAt, now],
      );
      return id;
    },
  };
}

async function decisionOf(mailboxId: string, emailId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ autoreply_decision: string }>(
    "SELECT autoreply_decision FROM spambank.ingested_message WHERE mailbox_id = $1 AND email_id = $2",
    [mailboxId, emailId],
  );
  return rows[0]?.autoreply_decision;
}

async function sentOn(day: Date): Promise<number> {
  const { rows } = await pool.query<{ sent: number }>(
    "SELECT sent FROM spambank.autoreply_day WHERE day = $1::date",
    [day.toISOString().slice(0, 10)],
  );
  return rows[0]?.sent ?? 0;
}

beforeAll(async () => {
  pool = testPool();
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  const { rows } = await owner.query<Record<string, unknown>>("SELECT * FROM spambank.control");
  saved = rows[0];
});

beforeEach(async () => {
  await owner.query(
    `UPDATE spambank.control SET daily_cap = 200, paused_at = NULL, paused_reason = NULL,
            tripped_at = NULL, tripped_reason = NULL, tripped_by = NULL`,
  );
});

afterAll(async () => {
  if (saved !== undefined) {
    await owner.query(
      `UPDATE spambank.control SET daily_cap = $1, paused_at = $2, paused_reason = $3, tripped_at = $4,
              tripped_reason = $5, tripped_by = $6, updated_by = $7, updated_at = $8`,
      [
        saved["daily_cap"],
        saved["paused_at"],
        saved["paused_reason"],
        saved["tripped_at"],
        saved["tripped_reason"],
        saved["tripped_by"],
        saved["updated_by"],
        saved["updated_at"],
      ],
    );
  }
  await owner.query("DELETE FROM spambank.autoreply WHERE org_domain = ANY($1)", [domains]);
  await owner.query("DELETE FROM spambank.autoreply_domain WHERE org_domain = ANY($1)", [domains]);
  await owner.query("DELETE FROM spambank.autoreply_day WHERE day = ANY($1::date[])", [days]);
  await deleteMailboxes(pool, mailboxes);
  await pool.end();
  await owner.end();
});

describe("dry_run", () => {
  it("records would_send for a qualifying newsletter and spends no slot", async () => {
    const w = await world();
    const domain = freshDomain();
    const id = await w.message(`news@${domain}`);
    expect(await runAutoreply(w.deps("dry_run"), { mailboxId: w.box.id, emailId: id })).toEqual({
      status: "decided",
      decision: "would_send",
    });
    expect(w.mailer.sent).toHaveLength(0);
    expect(await sentOn(w.now)).toBe(0);
    const { rows } = await pool.query(
      "SELECT 1 FROM spambank.autoreply_domain WHERE org_domain = $1",
      [domain],
    );
    expect(rows).toHaveLength(0);
    // A second message from the same domain is not throttled: dry_run claimed nothing.
    const again = await w.message(`offers@${domain}`);
    expect(
      await runAutoreply(w.deps("dry_run"), { mailboxId: w.box.id, emailId: again }),
    ).toMatchObject({
      decision: "would_send",
    });
  });

  it("refuses a no-reply sender and an unauthenticated one", async () => {
    const w = await world();
    const domain = freshDomain();
    const noreply = await w.message(`no-reply@${domain}`);
    expect(
      await runAutoreply(w.deps("dry_run"), { mailboxId: w.box.id, emailId: noreply }),
    ).toMatchObject({
      decision: "noreply_address",
    });
    const forged = await w.message(`news@${domain}`, {
      sender: {
        ...newsletterFrom(`news@${domain}`),
        "header:Authentication-Results:asText:all": [],
      },
    });
    expect(
      await runAutoreply(w.deps("dry_run"), { mailboxId: w.box.id, emailId: forged }),
    ).toMatchObject({
      decision: "unauthenticated",
    });
  });

  it("refuses mail in Spam, stale mail and a message that is gone", async () => {
    const w = await world();
    const domain = freshDomain();
    const spam = await w.message(`news@${domain}`, { folder: "spam" });
    const old = await w.message(`news@${domain}`, {
      receivedAt: new Date(w.now.getTime() - 49 * 3_600_000),
    });
    const gone = await w.message(`news@${domain}`);
    w.script.emails = Object.fromEntries(
      Object.entries(w.script.emails).filter(([key]) => key !== gone),
    );
    const run = (emailId: string) =>
      runAutoreply(w.deps("dry_run"), { mailboxId: w.box.id, emailId });
    expect(await run(spam)).toMatchObject({ decision: "not_inbound" });
    expect(await run(old)).toMatchObject({ decision: "stale" });
    expect(await run(gone)).toMatchObject({ decision: "not_inbound" });
  });
});

describe("redirect and live", () => {
  it("redirect sends to the tester, keeps the claims, then throttles the domain", async () => {
    const w = await world();
    const domain = freshDomain();
    const first = await w.message(`news@${domain}`);
    expect(await runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId: first })).toEqual(
      {
        status: "decided",
        decision: "redirected",
      },
    );
    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]?.to).toEqual(["tester@gmail.com"]);
    expect(w.mailer.sent[0]?.raw).toContain(`X-Spambank-Redirected-From: <news@${domain}>`);
    expect(w.mailer.sent[0]?.raw).toContain(
      `List-Unsubscribe: <https://yourtal.gaiada.com/api/spambank/optout/${domain}/`,
    );
    expect(await sentOn(w.now)).toBe(1);
    const { rows } = await pool.query<{
      status: string;
      mode: string;
      to_address: string;
      sent_at: Date | null;
    }>("SELECT status, mode, to_address, sent_at FROM spambank.autoreply WHERE org_domain = $1", [
      domain,
    ]);
    expect(rows).toEqual([
      {
        status: "sent",
        mode: "redirect",
        to_address: "tester@gmail.com",
        sent_at: expect.any(Date),
      },
    ]);
    const second = await w.message(`offers@${domain}`);
    expect(
      await runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId: second }),
    ).toMatchObject({
      decision: "throttled",
    });
    expect(w.mailer.sent).toHaveLength(1);
  });

  it("live sends to the sender, from reply@, once", async () => {
    const w = await world();
    const domain = freshDomain();
    const id = await w.message(`news@${domain}`);
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toMatchObject({
      decision: "sent",
    });
    expect(w.mailer.sent[0]?.to).toEqual([`news@${domain}`]);
    expect(w.mailer.sent[0]?.raw).toContain(`In-Reply-To: <${id}@mail.example>`);
    // The job fires again: nothing happens.
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toEqual({
      status: "skipped",
      reason: "not_queued",
    });
    expect(w.mailer.sent).toHaveLength(1);
  });

  it("honours an opt-out forever", async () => {
    const w = await world();
    const domain = freshDomain();
    await pool.query(
      "INSERT INTO spambank.autoreply_domain (org_domain, opted_out_at) VALUES ($1, now())",
      [domain],
    );
    const id = await w.message(`news@${domain}`);
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toMatchObject({
      decision: "opted_out",
    });
    expect(w.mailer.sent).toHaveLength(0);
  });

  it("stops at the daily cap and frees the domain claim", async () => {
    const w = await world();
    await owner.query("UPDATE spambank.control SET daily_cap = 1");
    const [a, b] = [freshDomain(), freshDomain()];
    const first = await w.message(`news@${a}`);
    const second = await w.message(`news@${b}`);
    expect(
      await runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId: first }),
    ).toMatchObject({
      decision: "redirected",
    });
    expect(
      await runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId: second }),
    ).toMatchObject({
      decision: "daily_cap",
    });
    const { rows } = await pool.query(
      "SELECT 1 FROM spambank.autoreply_domain WHERE org_domain = $1",
      [b],
    );
    expect(rows).toHaveLength(0);
    await owner.query("UPDATE spambank.control SET daily_cap = 0");
    const third = await w.message(`news@${freshDomain()}`);
    expect(
      await runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId: third }),
    ).toMatchObject({
      decision: "daily_cap",
    });
  });

  it("obeys the kill switch, the pause and the hard switch", async () => {
    const w = await world();
    const run = (emailId: string, mode: AutoreplyMode = "live") =>
      runAutoreply(w.deps(mode), { mailboxId: w.box.id, emailId });
    await owner.query("UPDATE spambank.control SET tripped_at = now()");
    expect(await run(await w.message(`news@${freshDomain()}`))).toMatchObject({
      decision: "disabled",
    });
    await owner.query("UPDATE spambank.control SET tripped_at = NULL, paused_at = now()");
    expect(await run(await w.message(`news@${freshDomain()}`))).toMatchObject({
      decision: "paused",
    });
    await owner.query("UPDATE spambank.control SET paused_at = NULL");
    expect(await run(await w.message(`news@${freshDomain()}`), "off")).toMatchObject({
      decision: "disabled",
    });
    expect(w.mailer.sent).toHaveLength(0);
  });

  it("records a failed send once and never retries it", async () => {
    const w = await world();
    const domain = freshDomain();
    w.mailer.fail = { ok: false, code: "rejected", detail: "forbiddenFrom", nothingSent: true };
    const id = await w.message(`news@${domain}`);
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toMatchObject({
      decision: "send_failed",
    });
    const { rows } = await pool.query<{ status: string; error: string }>(
      "SELECT status, error FROM spambank.autoreply WHERE org_domain = $1",
      [domain],
    );
    expect(rows).toEqual([{ status: "send_failed", error: "rejected: forbiddenFrom" }]);
  });

  it("leaves the message queued when Stalwart cannot be read, and the sweep hands it back", async () => {
    const w = await world();
    const id = await w.message(`news@${freshDomain()}`);
    w.script.down = failure("unavailable");
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toEqual({
      status: "skipped",
      reason: "unavailable",
    });
    expect(await decisionOf(w.box.id, id)).toBe("queued");
    const later = new Date(w.now.getTime() + 6 * 60_000);
    const swept = await sweepAutoreplies(pool, "live", later);
    expect(swept.requeue).toContainEqual({ mailboxId: w.box.id, emailId: id });
    // Past 48 hours it is stale instead.
    await sweepAutoreplies(pool, "live", new Date(w.now.getTime() + 49 * 3_600_000));
    expect(await decisionOf(w.box.id, id)).toBe("stale");
  });

  it("leaves the message queued when the reply account is not usable", async () => {
    const w = await world();
    w.mailer.prepareFails = true;
    const id = await w.message(`news@${freshDomain()}`);
    expect(await runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id })).toMatchObject({
      status: "skipped",
    });
    expect(await decisionOf(w.box.id, id)).toBe("queued");
  });
});

describe("races (BUILD.md T7 done-when 8)", () => {
  it("20 parallel jobs for one new domain send exactly one reply", async () => {
    const w = await world();
    const domain = freshDomain();
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => w.message(`news${String(i)}@${domain}`)),
    );
    const results = await Promise.all(
      ids.map((emailId) => runAutoreply(w.deps("redirect"), { mailboxId: w.box.id, emailId })),
    );
    const decisions = results.map((r) => (r.status === "decided" ? r.decision : r.reason));
    expect(decisions.filter((d) => d === "redirected")).toHaveLength(1);
    expect(decisions.filter((d) => d === "throttled")).toHaveLength(19);
    expect(w.mailer.sent).toHaveLength(1);
    expect(await sentOn(w.now)).toBe(1);
  });

  it("the same message run twice at once is decided once", async () => {
    const w = await world();
    const id = await w.message(`news@${freshDomain()}`);
    const results = await Promise.all([
      runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id }),
      runAutoreply(w.deps("live"), { mailboxId: w.box.id, emailId: id }),
    ]);
    expect(results.filter((r) => r.status === "decided")).toHaveLength(1);
    expect(w.mailer.sent).toHaveLength(1);
  });
});

describe("sweep", () => {
  it("with the hard switch off, decides every queued message as disabled", async () => {
    const w = await world();
    const id = await w.message(`news@${freshDomain()}`);
    await sweepAutoreplies(pool, "off", w.now);
    expect(await decisionOf(w.box.id, id)).toBe("disabled");
  });
});

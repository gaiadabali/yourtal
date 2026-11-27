import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { err, ok } from "neverthrow";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JmapRequest, SpambankAccountClient, SpambankDriver } from "@yourtal/drivers/spambank";
import { OWNER_URL } from "../../../../../../packages/db/src/database-urls";
import { RUN, failure, testPool } from "../ingest/test-support";
import { runBlocklistCheck } from "./blocklist";
import { mountSpambankOptout } from "./mount-optout";
import { optoutSig } from "./optout";
import { DONE_KEYWORD, processReplyInbox } from "./reply-inbox";

/**
 * BUILD.md §4.6 "Bounces and complaints", "Blocklists" and "Opt-out" against the real schema: a DSN for one
 * of our replies is counted once however often it is read, two complaints pause the replies and alert,
 * a person answering opts their domain out, a listed blocklist answer pauses, and the one-click POST opts out
 * while a GET only reads.
 */

const DOMAIN = "spambank.yourtal.gaiada.com";
const KEY = "q".repeat(43);
let pool: Pool;
let owner: Pool;
let saved: Record<string, unknown> | undefined;
const domains: string[] = [];
const days: string[] = [];
const autoreplies: string[] = [];
let n = 0;

function freshDomain(): string {
  n += 1;
  const d = `t7r${RUN}x${String(n)}.com.au`;
  domains.push(d);
  return d;
}

function freshNow(): Date {
  const now = new Date(
    Date.UTC(2093, 0, 1, 12) + (n + 1) * 86_400_000 + Math.floor(Math.random() * 300) * 86_400_000,
  );
  days.push(now.toISOString().slice(0, 10));
  return now;
}

async function sentReply(domain: string, now: Date): Promise<string> {
  const id = randomUUID();
  autoreplies.push(id);
  await owner.query(
    `INSERT INTO spambank.autoreply (id, org_domain, to_address, message_id, mode, status, created_at, sent_at)
     VALUES ($1, $2, $3, $4, 'live', 'sent', $5, $5)`,
    [id, domain, `news@${domain}`, `autoreply-${id}@${DOMAIN}`, now],
  );
  return id;
}

/** A Stalwart with one Inbox per system account, serving raw messages by blob id. */
function inboxDriver(byLocal: Record<string, string[]>): {
  driver: SpambankDriver;
  marked: string[];
} {
  const marked: string[] = [];
  const run = randomUUID().slice(0, 8);
  const client = (local: string): SpambankAccountClient => {
    const messages = byLocal[local] ?? [];
    const ids = messages.map((_, i) => `${local}${run}-${String(i)}`);
    return {
      login: `${local}@${DOMAIN}`,
      jmap(request: JmapRequest) {
        return Promise.resolve(
          ok({
            methodResponses: request.methodCalls.map(([name, args, callId]) => {
              if (name === "Mailbox/get")
                return [name, { list: [{ id: "in", role: "inbox" }] }, callId] as const;
              if (name === "Email/query") {
                return [name, { ids: ids.filter((id) => !marked.includes(id)) }, callId] as const;
              }
              if (name === "Email/get") {
                const wanted = (args["ids"] as string[]) ?? [];
                return [
                  name,
                  { list: wanted.map((id) => ({ id, blobId: `B${id}` })) },
                  callId,
                ] as const;
              }
              if (name === "Email/set") {
                marked.push(...Object.keys((args["update"] as Record<string, unknown>) ?? {}));
                return [name, { updated: {} }, callId] as const;
              }
              return ["error", { type: "unknownMethod" }, callId] as const;
            }),
          }),
        );
      },
      fetch(path: string) {
        if (local === "postmaster") return Promise.resolve(err(failure("upstream_auth")));
        if (path === "/jmap/session") {
          return Promise.resolve(
            ok(
              Response.json({
                primaryAccounts: { "urn:ietf:params:jmap:mail": "A" },
                accounts: { A: {} },
              }),
            ),
          );
        }
        const match = /\/jmap\/download\/A\/B([^/]+)\//.exec(path);
        const index = ids.indexOf(match?.[1] ?? "");
        return Promise.resolve(
          ok(new Response(messages[index] ?? "", { status: index < 0 ? 404 : 200 })),
        );
      },
    };
  };
  const driver = { account: (local: string) => client(local) } as unknown as SpambankDriver;
  return { driver, marked };
}

function dsnFor(id: string): string {
  return [
    "Return-Path: <>",
    "From: MAILER-DAEMON@mx.example.net",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
    "",
    "--b",
    "Content-Type: message/delivery-status",
    "",
    "Action: failed",
    "--b",
    "Content-Type: text/rfc822-headers",
    "",
    `Message-ID: <autoreply-${id}@${DOMAIN}>`,
    "--b--",
  ].join("\r\n");
}

function arfFor(id: string): string {
  return [
    "From: fbl@isp.example.net",
    'Content-Type: multipart/report; report-type="feedback-report"; boundary="f"',
    "",
    "--f",
    "Content-Type: message/rfc822",
    "",
    `Message-ID: <autoreply-${id}@${DOMAIN}>`,
    "--f--",
  ].join("\r\n");
}

async function day(now: Date): Promise<{ bounces: number; complaints: number }> {
  const { rows } = await pool.query<{ bounces: number; complaints: number }>(
    "SELECT bounces, complaints FROM spambank.autoreply_day WHERE day = $1::date",
    [now.toISOString().slice(0, 10)],
  );
  return rows[0] ?? { bounces: 0, complaints: 0 };
}

beforeAll(async () => {
  pool = testPool();
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  saved = (await owner.query<Record<string, unknown>>("SELECT * FROM spambank.control")).rows[0];
});

beforeEach(async () => {
  await owner.query("UPDATE spambank.control SET paused_at = NULL, paused_reason = NULL");
});

afterAll(async () => {
  if (saved !== undefined) {
    await owner.query("UPDATE spambank.control SET paused_at = $1, paused_reason = $2", [
      saved["paused_at"],
      saved["paused_reason"],
    ]);
  }
  await owner.query("DELETE FROM spambank.reply_inbox_message WHERE login LIKE '%@' || $1", [
    DOMAIN,
  ]);
  await owner.query("DELETE FROM spambank.autoreply WHERE id = ANY($1::uuid[])", [autoreplies]);
  await owner.query("DELETE FROM spambank.autoreply_domain WHERE org_domain = ANY($1)", [domains]);
  await owner.query("DELETE FROM spambank.autoreply_day WHERE day = ANY($1::date[])", [days]);
  await owner.query("DELETE FROM spambank.blocklist_check WHERE target LIKE $1", [`%${RUN}%`]);
  await pool.end();
  await owner.end();
});

describe("reply-inbox", () => {
  it("counts a bounce once, however often the message is read", async () => {
    const now = freshNow();
    const domain = freshDomain();
    const id = await sentReply(domain, now);
    const alerts: string[] = [];
    const { driver, marked } = inboxDriver({ reply: [dsnFor(id)] });
    const deps = {
      pool,
      driver,
      replyDomain: DOMAIN,
      alerter: { alert: (s: string) => Promise.resolve(void alerts.push(s)) },
      now: () => now,
      log: () => undefined,
    };
    const first = await processReplyInbox(deps);
    expect(first.counted.bounce).toBe(1);
    expect(first.unavailable).toEqual(["postmaster:upstream_auth"]);
    expect(marked).toHaveLength(1);
    marked.length = 0; // the keyword was lost: the message is read again
    expect((await processReplyInbox(deps)).counted.bounce).toBe(0);
    expect(await day(now)).toEqual({ bounces: 1, complaints: 0 });
    const { rows } = await pool.query("SELECT status FROM spambank.autoreply WHERE id = $1", [id]);
    expect(rows).toEqual([{ status: "bounced" }]);
    expect(alerts).toEqual([]);
    expect(DONE_KEYWORD).toBe("$spambank_done");
  });

  it("two complaints to abuse@ opt the domain out, pause the replies and alert once", async () => {
    const now = freshNow();
    const domain = freshDomain();
    const a = await sentReply(domain, now);
    const b = await sentReply(domain, now);
    const alerts: string[] = [];
    const { driver } = inboxDriver({ abuse: [arfFor(a), arfFor(b)] });
    const result = await processReplyInbox({
      pool,
      driver,
      replyDomain: DOMAIN,
      alerter: { alert: (s: string) => Promise.resolve(void alerts.push(s)) },
      now: () => now,
      log: () => undefined,
    });
    expect(result.counted.complaint).toBe(2);
    expect(result.pausedReason).toContain("2 complaints");
    expect(alerts).toEqual(["auto-reply paused"]);
    const control = await pool.query<{ paused: boolean }>(
      "SELECT paused_at IS NOT NULL AS paused FROM spambank.control",
    );
    expect(control.rows[0]?.paused).toBe(true);
    const opted = await pool.query(
      "SELECT opted_out_at FROM spambank.autoreply_domain WHERE org_domain = $1",
      [domain],
    );
    expect(opted.rows[0]).toEqual({ opted_out_at: expect.any(Date) });
  });

  it("a person writing back opts their domain out", async () => {
    const now = freshNow();
    const domain = freshDomain();
    const id = await sentReply(domain, now);
    const answer = [
      `From: Sam <sam@${domain}>`,
      `In-Reply-To: <autoreply-${id}@${DOMAIN}>`,
      "",
      "Stop please.",
    ].join("\r\n");
    const { driver } = inboxDriver({ reply: [answer] });
    const result = await processReplyInbox({
      pool,
      driver,
      replyDomain: DOMAIN,
      alerter: { alert: () => Promise.resolve() },
      now: () => now,
      log: () => undefined,
    });
    expect(result.counted.answer).toBe(1);
    const opted = await pool.query(
      "SELECT 1 FROM spambank.autoreply_domain WHERE org_domain = $1 AND opted_out_at IS NOT NULL",
      [domain],
    );
    expect(opted.rows).toHaveLength(1);
  });
});

describe("blocklist check", () => {
  it("writes a row per lookup and reports a listing (the job pauses on it)", async () => {
    const now = freshNow();
    const target = `t7bl${RUN}.example`;
    const run = await runBlocklistCheck({
      db: pool,
      lookup: (name) =>
        Promise.resolve(
          name.endsWith("dbl.spamhaus.org")
            ? { status: "found", addresses: ["127.0.1.2"] }
            : { status: "nxdomain" },
        ),
      ips: ["187.77.116.133"],
      domains: [target],
      now,
    });
    expect(run.rows.map((r) => `${r.list}=${r.result}`)).toEqual([
      "zen.spamhaus.org=clean",
      "bl.spamcop.net=clean",
      "dbl.spamhaus.org=listed",
    ]);
    expect(run.listed).toHaveLength(1);
    const { rows } = await pool.query(
      "SELECT result FROM spambank.blocklist_check WHERE target = $1",
      [target],
    );
    expect(rows).toEqual([{ result: "listed" }]);
    await owner.query(
      "DELETE FROM spambank.blocklist_check WHERE target = '187.77.116.133' AND checked_at = $1",
      [now],
    );
  });
});

describe("opt-out routes", () => {
  it("POST opts out with the RFC 8058 form body; GET only reads; a bad link is 404", async () => {
    const app = Fastify({ forceCloseConnections: true });
    await mountSpambankOptout(app, { pool, optoutKey: KEY });
    const domain = freshDomain();
    const path = `/api/spambank/optout/${domain}/${optoutSig(KEY, domain)}`;
    try {
      const before = await app.inject({ method: "GET", url: path });
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual({ domain, optedOut: false });
      expect((await app.inject({ method: "GET", url: path })).json()).toEqual({
        domain,
        optedOut: false,
      });

      const posted = await app.inject({
        method: "POST",
        url: path,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      expect(posted.statusCode).toBe(200);
      expect(posted.headers["content-type"]).toContain("text/plain");
      expect((await app.inject({ method: "GET", url: path })).json()).toEqual({
        domain,
        optedOut: true,
      });

      const multipart = await app.inject({
        method: "POST",
        url: path,
        headers: { "content-type": "multipart/form-data; boundary=x" },
        payload:
          '--x\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--x--\r\n',
      });
      expect(multipart.statusCode).toBe(200);

      const forged = `/api/spambank/optout/${domain}/${"A".repeat(22)}`;
      expect((await app.inject({ method: "GET", url: forged })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: forged, payload: "" })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: "GET", url: "/api/spambank/optout/localhost/x" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("answers 503 when no opt-out key is configured", async () => {
    const app = Fastify({ forceCloseConnections: true });
    await mountSpambankOptout(app, { pool, optoutKey: undefined });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/spambank/optout/brand.com.au/${"A".repeat(22)}`,
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});

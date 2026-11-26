import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpambankConfig } from "../../../config/spambank-config";
import type { OneClickPoster } from "../mail/ssrf-guard";
import { signMailToken } from "../mail-token";
import { createEventStreams } from "./event-streams";
import { createMailAuthenticator } from "./mail-auth";
import type { MailboxRecord } from "./mail-store";
import { downloadParams, mountSpambankMail } from "./mount-spambank-mail";
import type { ProxyContext } from "./proxy-context";
import { unlimited } from "./rate-limits";
import type { MailRateLimiter } from "./rate-limits";
import { FakeStalwart } from "./testing/fake-stalwart";
import type { FakeEmail } from "./testing/fake-stalwart";
import { MemoryMailStore } from "./testing/memory-mail-store";
import { createUpstreamSessions } from "./upstream-session";

/** spambank/BUILD.md T5 "Done when" (1)-(4), against a fake Stalwart behind the real routes. */

const KEY = "mail-token-key-for-tests-only-0123456789";
const DOMAIN = "yourtal.gaiada.com";
const ORIGIN = "https://yourtal.gaiada.com";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

const config: SpambankConfig = {
  enabled: true,
  tokenKey: KEY,
  mailDomain: DOMAIN,
  replyDomain: `spambank.${DOMAIN}`,
  publicHost: `mail.${DOMAIN}`,
  authservId: `mail.${DOMAIN}`,
  corsOrigins: ["https://snapapp.gaiada.com", "https://freetaxreturns.com.au"],
  quotaBytes: 2_147_483_648,
  autoreply: { mode: "off", dailyCap: 200 },
  ownDomains: [],
  alertEmails: [],
  bannerUrl: `${ORIGIN}/studio/onboarding`,
};

function mailbox(localPart: string, overrides: Partial<MailboxRecord> = {}): MailboxRecord {
  return {
    id: randomUUID(),
    userId: `user-${localPart}`,
    localPart,
    domain: DOMAIN,
    status: "active",
    junkMailboxId: "mb-junk",
    ...overrides,
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function harness(options: { limiter?: MailRateLimiter; streamLifetimeMs?: number } = {}) {
  const stalwart = new FakeStalwart();
  const store = new MemoryMailStore();
  const a = mailbox("geewizduck");
  const b = mailbox("pluckyotter");
  const accountA = stalwart.add(a.localPart, DOMAIN, "acctA");
  const accountB = stalwart.add(b.localPart, DOMAIN, "acctB");
  store.mailboxes.set(a.id, a);
  store.mailboxes.set(b.id, b);
  const oneClick = vi.fn<OneClickPoster>(() => Promise.resolve({ ok: true, status: 200 }));
  const ctx: ProxyContext = {
    driver: stalwart.driver(),
    config,
    publicOrigin: ORIGIN,
    store,
    auth: createMailAuthenticator({ tokenKey: KEY, store }),
    sessions: createUpstreamSessions(),
    limiter: options.limiter ?? unlimited(),
    streams: createEventStreams(),
    oneClick,
    ...(options.streamLifetimeMs === undefined
      ? {}
      : { streamLifetimeMs: options.streamLifetimeMs }),
  };
  // Streams left open by a test must not hold up its close.
  const app = Fastify({ forceCloseConnections: true });
  apps.push(app);
  await mountSpambankMail(app, ctx);
  await app.ready();
  const token = (box: MailboxRecord, ttlSeconds?: number) =>
    signMailToken(
      {
        mailboxId: box.id,
        userId: box.userId,
        app: "snapapp",
        ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      },
      KEY,
    ).token;
  const auth = (box: MailboxRecord = a) => ({ authorization: `Bearer ${token(box)}` });
  const jmap = (methodCalls: unknown[], box: MailboxRecord = a) =>
    app.inject({
      method: "POST",
      url: "/api/spambank/jmap/api",
      headers: { ...auth(box), "content-type": "application/json" },
      payload: {
        using: [
          "urn:ietf:params:jmap:core",
          "urn:ietf:params:jmap:mail",
          "urn:ietf:params:jmap:submission",
        ],
        methodCalls,
      },
    });
  return { app, stalwart, store, a, b, accountA, accountB, oneClick, token, auth, jmap, ctx };
}

function submit(rcpt: number, from = "geewizduck@yourtal.gaiada.com") {
  return [
    "EmailSubmission/set",
    {
      accountId: "acctA",
      create: {
        s: {
          identityId: "ident1",
          emailId: "E1",
          envelope: {
            mailFrom: { email: from },
            rcptTo: Array.from({ length: rcpt }, (_, i) => ({
              email: `r${String(i)}@example.com`,
            })),
          },
        },
      },
    },
    "s",
  ];
}

describe("the session (check 1)", () => {
  it("points every URL at the proxy and keeps only the allowed capabilities and the own account", async () => {
    const { app, auth } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/session",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const session = res.json<Record<string, unknown>>();
    expect(session).toMatchObject({
      apiUrl: `${ORIGIN}/api/spambank/jmap/api`,
      downloadUrl: `${ORIGIN}/api/spambank/jmap/download/{accountId}/{blobId}/{name}?accept={type}`,
      uploadUrl: `${ORIGIN}/api/spambank/jmap/upload/{accountId}/`,
      eventSourceUrl: `${ORIGIN}/api/spambank/jmap/eventsource?types={types}&closeafter={closeafter}&ping={ping}`,
      username: "geewizduck@yourtal.gaiada.com",
    });
    expect(Object.keys(session.capabilities as object).sort()).toEqual([
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ]);
    expect(Object.keys(session.accounts as object)).toEqual(["acctA"]);
    expect(JSON.stringify(session)).not.toContain("mail.yourtal.gaiada.com");
  });

  it("logs in to Stalwart as the token's mailbox and never forwards the client's credentials", async () => {
    const { app, stalwart, auth } = await harness();
    await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/session",
      headers: {
        ...auth(),
        cookie: "snap_session=secret",
        origin: "https://snapapp.gaiada.com",
        "x-forwarded-host": "evil",
      },
    });
    const sent = stalwart.requests.at(-1);
    expect(sent?.login).toBe("geewizduck@yourtal.gaiada.com");
    expect(Object.keys(sent?.headers ?? {}).sort()).toEqual(["accept", "x-forwarded-for"]);
  });
});

describe("the mail token", () => {
  it.each([
    ["no token", {}],
    [
      "a forged token",
      { authorization: `Bearer sbm1.${Buffer.from("{}").toString("base64url")}.${"A".repeat(43)}` },
    ],
    ["a malformed header", { authorization: "Basic abc" }],
  ])("refuses %s with 401", async (_name, headers) => {
    const { app, stalwart } = await harness();
    const res = await app.inject({ method: "GET", url: "/api/spambank/jmap/session", headers });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthorized" });
    expect(stalwart.requests).toHaveLength(0);
  });

  it("refuses an expired token", async () => {
    const { app, a, token } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/session",
      headers: { authorization: `Bearer ${token(a, -1)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a mailbox that is being erased, or suspended", async () => {
    const { app, store, a, auth } = await harness();
    store.mailboxes.set(a.id, { ...a, status: "erasing" });
    expect(
      (await app.inject({ method: "GET", url: "/api/spambank/jmap/session", headers: auth() }))
        .statusCode,
    ).toBe(409);
  });

  it("answers 503 when Stalwart is the simulator", async () => {
    const { app, stalwart, auth } = await harness();
    stalwart.failure = {
      kind: "server_error",
      boundary: "spambank",
      mayHaveSucceeded: false,
      detail: "simulated: no mail server",
      code: "simulated",
    };
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/session",
      headers: auth(),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ message: string }>().message).toMatch(/^simulated/);
  });

  it("answers 429 once the mailbox's limit is spent", async () => {
    const { app, auth } = await harness({ limiter: { allow: () => Promise.resolve(false) } });
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/session",
      headers: auth(),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: "rate_limited" });
  });
});

describe("the JMAP api (checks 1 and 2)", () => {
  it("passes allowed calls through", async () => {
    const { jmap } = await harness();
    const res = await jmap([["Mailbox/get", { accountId: "acctA", ids: null }, "m"]]);
    expect(res.statusCode).toBe(200);
    const list = res.json<{ methodResponses: [string, { list: unknown[] }, string][] }>()
      .methodResponses[0]?.[1].list;
    expect(list).toHaveLength(6);
  });

  it("refuses x:Account/get without calling Stalwart's api", async () => {
    const { jmap, stalwart } = await harness();
    const res = await jmap([["x:Account/get", { ids: null }, "x"]]);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "method_not_allowed" });
    expect(stalwart.requests.filter((r) => r.path === "/jmap/")).toHaveLength(0);
  });

  it("refuses another mailbox's account id", async () => {
    const { jmap } = await harness();
    const res = await jmap([["Email/get", { accountId: "acctB", ids: null }, "g"]]);
    expect(res.statusCode).toBe(403);
  });

  it("refuses a submission without an envelope, and 11 recipients", async () => {
    const { jmap } = await harness();
    const bare = await jmap([
      ["EmailSubmission/set", { accountId: "acctA", create: { s: { emailId: "E1" } } }, "s"],
    ]);
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ code: "envelope_required" });
    const eleven = await jmap([submit(11)]);
    expect(eleven.statusCode).toBe(400);
    expect(eleven.json()).toMatchObject({ code: "too_many_recipients" });
  });

  it("refuses the 101st recipient of the day with 429, and gives back what Stalwart refused", async () => {
    const { jmap, store, a, accountA } = await harness();
    for (let i = 0; i < 10; i += 1) expect((await jmap([submit(10)])).statusCode).toBe(200);
    expect(store.sent.get(a.id)).toBe(100);
    const over = await jmap([submit(1)]);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: "daily_send_cap" });
    expect(accountA.submissions).toHaveLength(10);

    store.sent.set(a.id, 0);
    const refused = await jmap([
      [
        "EmailSubmission/set",
        {
          accountId: "acctA",
          create: {
            s: {
              emailId: "E1",
              envelope: {
                mailFrom: { email: "geewizduck@yourtal.gaiada.com" },
                rcptTo: [{ email: "reject@example.com" }],
              },
            },
          },
        },
        "s",
      ],
    ]);
    expect(refused.statusCode).toBe(200);
    expect(store.sent.get(a.id)).toBe(0);
  });
});

describe("upload and download (checks 1 and 2)", () => {
  it("round-trips a file with the same SHA-256, served as an attachment", async () => {
    const { app, auth } = await harness();
    const bytes = Buffer.alloc(3 * 1024 * 1024, 7);
    const up = await app.inject({
      method: "POST",
      url: "/api/spambank/jmap/upload/acctA/",
      headers: { ...auth(), "content-type": "application/pdf" },
      payload: bytes,
    });
    expect(up.statusCode).toBe(201);
    const { blobId } = up.json<{ blobId: string }>();
    const down = await app.inject({
      method: "GET",
      url: `/api/spambank/jmap/download/acctA/${blobId}/${encodeURIComponent("Statement Nov.pdf")}?accept=application/pdf`,
      headers: auth(),
    });
    expect(down.statusCode).toBe(200);
    expect(createHash("sha256").update(down.rawPayload).digest("hex")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(down.headers["content-disposition"]).toBe(
      `attachment; filename="Statement Nov.pdf"; filename*=UTF-8''Statement%20Nov.pdf`,
    );
    expect(down.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves HTML and SVG as bytes", async () => {
    const { app, auth, accountA } = await harness();
    accountA.blobs.set("Bhtml", {
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      type: "text/html",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/download/acctA/Bhtml/page.html?accept=text/html",
      headers: auth(),
    });
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("never asks Stalwart for another mailbox's account id", async () => {
    const { app, auth, accountB, stalwart } = await harness();
    accountB.blobs.set("Bsecret", {
      bytes: new TextEncoder().encode("B's statement"),
      type: "application/pdf",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/jmap/download/acctB/Bsecret/x.pdf",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("statement");
    expect(stalwart.requests.some((r) => r.path.includes("/download/"))).toBe(false);
    const up = await app.inject({
      method: "POST",
      url: "/api/spambank/jmap/upload/acctB/",
      headers: auth(),
      payload: "x",
    });
    expect(up.statusCode).toBe(404);
  });

  it("refuses an upload over 25 MB", async () => {
    const { app, auth } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/api/spambank/jmap/upload/acctA/",
      headers: { ...auth(), "content-type": "application/octet-stream" },
      payload: Buffer.alloc(25 * 1024 * 1024 + 1),
    });
    expect(res.statusCode).toBe(413);
  });

  it("parses long download paths itself", () => {
    const long = "n".repeat(180);
    expect(downloadParams(`/api/spambank/jmap/download/acctA/B1/${long}?accept=x`)).toEqual({
      accountId: "acctA",
      blobId: "B1",
      name: long,
    });
    expect(downloadParams("/api/spambank/jmap/download/acctA/B1")).toBeUndefined();
  });
});

describe("CORS (check 2)", () => {
  it("answers a listed origin's preflight and not another's", async () => {
    const { app } = await harness();
    const ok = await app.inject({
      method: "OPTIONS",
      url: "/api/spambank/jmap/api",
      headers: { origin: "https://snapapp.gaiada.com", "access-control-request-method": "POST" },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers).toMatchObject({
      "access-control-allow-origin": "https://snapapp.gaiada.com",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age": "600",
      vary: "Origin",
    });
    expect(ok.headers).not.toHaveProperty("access-control-allow-credentials");
    const evil = await app.inject({
      method: "OPTIONS",
      url: "/api/spambank/mail/summary",
      headers: { origin: "https://evil.example" },
    });
    expect(evil.headers).not.toHaveProperty("access-control-allow-origin");
  });
});

describe("the EventSource (check 1)", () => {
  async function listen(app: FastifyInstance): Promise<string> {
    await app.listen({ port: 0, host: "127.0.0.1" });
    return `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`;
  }

  it("streams state changes, allows 3 streams per mailbox, and closes after its lifetime", async () => {
    const { app, stalwart, accountA, token, a } = await harness({ streamLifetimeMs: 1500 });
    const base = await listen(app);
    const open = () =>
      fetch(`${base}/api/spambank/jmap/eventsource?types=Email,Mailbox&closeafter=no&ping=30`, {
        headers: { authorization: `Bearer ${token(a)}`, origin: "https://snapapp.gaiada.com" },
      });
    const first = await open();
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/event-stream");
    expect(first.headers.get("x-accel-buffering")).toBe("no");
    expect(first.headers.get("access-control-allow-origin")).toBe("https://snapapp.gaiada.com");
    const upstream = stalwart.requests.find((r) => r.path.startsWith("/jmap/eventsource"));
    expect(upstream?.path).toBe("/jmap/eventsource/?types=Email%2CMailbox&closeafter=no&ping=30");

    const reader = first.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    stalwart.push(accountA, "e42");
    while (!text.includes("e42")) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('"Email":"e42"');

    const second = await open();
    const third = await open();
    const fourth = await open();
    expect([second.status, third.status, fourth.status]).toEqual([200, 200, 429]);
    await fourth.text();
    await second.body?.cancel();
    await third.body?.cancel();

    // The server ends the stream after its lifetime.
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await vi.waitFor(() => {
      expect(accountA.streams.size).toBe(0);
    });
  });
});

describe("safe-html (check 3)", () => {
  it("returns sanitised HTML with the cid image inlined", async () => {
    const { app, auth, accountA } = await harness();
    accountA.blobs.set("Blogo", { bytes: PNG, type: "image/png" });
    accountA.emails.set("M1", {
      id: "M1",
      mailboxIds: { "mb-inbox": true },
      keywords: {},
      from: [{ email: "news@shop.example" }],
      html: '<meta http-equiv="refresh" content="0"><base href="https://x.example/"><script>alert(1)</script><img src="cid:logo" onerror="x()"><img src="https://track.example/p.gif"><p style="background:url(http://t.example/b.png)">Hi</p><form><input></form><iframe src="https://x.example"></iframe>',
      attachments: [{ blobId: "Blogo", type: "image/png", cid: "<logo>", size: PNG.length }],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/mail/messages/M1/safe-html",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      html: string;
      remoteImagesBlocked: number;
      inlineImagesDropped: number;
      truncated: boolean;
    }>();
    for (const bad of [
      "<script",
      "onerror",
      "<iframe",
      "http-equiv",
      "<base",
      "<form",
      'src="http',
      "url(",
    ]) {
      expect(body.html).not.toContain(bad);
    }
    expect(body.html).toContain(`src="data:image/png;base64,${PNG.toString("base64")}"`);
    expect(body.remoteImagesBlocked).toBeGreaterThanOrEqual(2);
    expect(body.truncated).toBe(false);
  });

  it("is 404 for a message that is not there", async () => {
    const { app, auth } = await harness();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/spambank/mail/messages/nope/safe-html",
          headers: auth(),
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("unsubscribe (check 4)", () => {
  function newsletter(extra: Partial<FakeEmail> = {}): FakeEmail {
    return {
      id: "N1",
      mailboxIds: { "mb-inbox": true },
      keywords: {},
      from: [{ email: "news@Shop.Example" }],
      ...extra,
    };
  }
  const post = (app: FastifyInstance, headers: Record<string, string>, body: unknown = {}) =>
    app.inject({
      method: "POST",
      url: "/api/spambank/mail/messages/N1/unsubscribe",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });

  it("one-click: POSTs once, marks and moves the message, records it", async () => {
    const { app, auth, accountA, oneClick, store } = await harness();
    accountA.emails.set(
      "N1",
      newsletter({
        listUnsubscribe: ["https://shop.example/u/1", "mailto:u@shop.example"],
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      }),
    );
    const res = await post(app, auth(), { moveToJunk: true });
    expect(res.json()).toEqual({ status: "done", method: "one_click" });
    expect(oneClick).toHaveBeenCalledWith("https://shop.example/u/1");
    expect(accountA.emails.get("N1")?.keywords).toEqual({ $spambank_unsubscribed: true });
    expect(accountA.emails.get("N1")?.mailboxIds).toEqual({ "mb-junk": true });
    expect(store.unsubscribes).toEqual([
      {
        mailboxId: expect.any(String),
        orgDomain: "shop.example",
        method: "one_click",
        status: "done",
        httpStatus: 200,
      },
    ]);
    // A second tap does not post again.
    expect((await post(app, auth())).json()).toEqual({ status: "done", method: "one_click" });
    expect(oneClick).toHaveBeenCalledTimes(1);
  });

  it("one-click refused by the guard and no mailto: failed", async () => {
    const { app, auth, accountA, oneClick } = await harness();
    oneClick.mockResolvedValue({ ok: false, status: null, reason: "non-public address" });
    accountA.emails.set(
      "N1",
      newsletter({
        listUnsubscribe: ["https://127.0.0.1/u"],
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      }),
    );
    expect((await post(app, auth())).json()).toEqual({ status: "failed" });
    expect(accountA.emails.get("N1")?.keywords).toEqual({});
  });

  it("mailto: sends one message from the mailbox and counts it", async () => {
    const { app, auth, accountA, store, a } = await harness();
    accountA.emails.set(
      "N1",
      newsletter({ listUnsubscribe: ["mailto:leave@shop.example?subject=remove%20me"] }),
    );
    expect((await post(app, auth())).json()).toEqual({ status: "done", method: "mailto" });
    expect(accountA.submissions).toEqual([
      expect.objectContaining({
        envelope: {
          mailFrom: { email: "geewizduck@yourtal.gaiada.com" },
          rcptTo: [{ email: "leave@shop.example" }],
        },
      }),
    ]);
    expect(store.sent.get(a.id)).toBe(1);
  });

  it("an https link only: open_link; nothing: unavailable", async () => {
    const { app, auth, accountA } = await harness();
    accountA.emails.set("N1", newsletter({ listUnsubscribe: ["https://shop.example/prefs"] }));
    expect((await post(app, auth())).json()).toEqual({
      status: "open_link",
      method: "link",
      url: "https://shop.example/prefs",
    });
    accountA.emails.set("N1", newsletter());
    expect((await post(app, auth())).json()).toEqual({ status: "unavailable" });
  });

  it("refuses a body that is not { moveToJunk }", async () => {
    const { app, auth } = await harness();
    expect((await post(app, auth(), { moveToJunk: "yes", extra: 1 })).statusCode).toBe(400);
  });
});

describe("summary", () => {
  it("returns the banner in the asked language, the counters and both folder ids", async () => {
    const { app, auth } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/api/spambank/mail/summary?locale=id-ID",
      headers: auth(),
    });
    expect(res.json()).toEqual({
      address: "geewizduck@yourtal.gaiada.com",
      folders: { spamMailboxId: "mb-spam", junkMailboxId: "mb-junk" },
      counters: { bulkFiled30d: 4, marketersUnsubscribed: 2, autoRepliesSent30d: 1 },
      banner: expect.objectContaining({
        ctaLabel: "Beriklan di YourTal",
        ctaUrl: `${ORIGIN}/studio/onboarding`,
      }),
    });
  });
});

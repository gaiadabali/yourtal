import { describe, expect, it } from "vitest";
import { derivePassword, loginFor } from "./credentials";
import { createLiveSpambank, resolveUpstream } from "./live";

/**
 * The live driver against a stub of Stalwart's JMAP `x:` API (STALWART-NOTES.md). The response shapes
 * are the documented ones; T0's recorded fixtures replace them where they differ.
 */

const BASE = "http://127.0.0.1:18080";
const CREDENTIAL_KEY = "credential-key-credential-key-credential-key";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

type Reply = Response | Error | ((seen: Seen) => Response);

/** A fetch that records each request and answers from a queue. */
function stub(replies: Reply[]): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const entry: Seen = {
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? "GET",
      headers,
      body: raw === undefined ? undefined : (JSON.parse(raw) as unknown),
    };
    seen.push(entry);
    const next = replies.shift();
    if (next === undefined) return Promise.reject(new Error("unexpected request"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(typeof next === "function" ? next(entry) : next);
  };
  return { fetch: fakeFetch, seen };
}

function jmap(methodResponses: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ methodResponses, sessionState: "s1" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function driver(replies: Reply[], apiKey = "API_secretsecretsecret") {
  const s = stub(replies);
  return {
    seen: s.seen,
    driver: createLiveSpambank({
      baseUrl: BASE,
      apiKey,
      credentialKey: CREDENTIAL_KEY,
      fetch: s.fetch,
    }),
  };
}

const domains = (): Response =>
  jmap([
    [
      "x:Domain/get",
      {
        list: [
          { id: "b", name: "yourtal.gaiada.com" },
          { id: "c", name: "spambank.yourtal.gaiada.com" },
        ],
      },
      "c1",
    ],
  ]);

describe("construction", () => {
  it("makes no request, so a Stalwart that is down cannot stop a boot", () => {
    const { seen } = driver([]);
    expect(seen).toHaveLength(0);
  });

  it("refuses an address with a path, a short key, a missing API key and a non-http scheme", () => {
    const make = (over: Partial<Parameters<typeof createLiveSpambank>[0]>) =>
      createLiveSpambank({ baseUrl: BASE, apiKey: "k", credentialKey: CREDENTIAL_KEY, ...over });
    expect(() => make({ baseUrl: `${BASE}/jmap` })).toThrow(/address only/);
    expect(() => make({ baseUrl: "ftp://x" })).toThrow(/http/);
    expect(() => make({ baseUrl: "nonsense" })).toThrow(/not a URL/);
    expect(() => make({ credentialKey: "short" })).toThrow(/32/);
    expect(() => make({ apiKey: "" })).toThrow(/API_KEY/);
  });
});

describe("management calls", () => {
  it("lists the domains with the API key as a bearer token", async () => {
    const { driver: d, seen } = driver([domains()]);
    const result = await d.listDomains();
    expect(result._unsafeUnwrap().map((domain) => domain.name)).toStrictEqual([
      "yourtal.gaiada.com",
      "spambank.yourtal.gaiada.com",
    ]);
    expect(seen[0]?.url).toBe(`${BASE}/jmap/`);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer API_secretsecretsecret");
    expect(seen[0]?.body).toMatchObject({
      using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [["x:Domain/get", { ids: null }, "c1"]],
    });
  });

  it("sends a user:secret key as HTTP Basic", async () => {
    const { driver: d, seen } = driver([domains()], "admin:hunter2");
    expect((await d.listDomains()).isOk()).toBe(true);
    expect(seen[0]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("admin:hunter2").toString("base64")}`,
    );
  });

  it("creates an account with the derived password and the quota", async () => {
    const { driver: d, seen } = driver([
      domains(),
      jmap([["x:Account/set", { created: { a: { id: "acc-1" } } }, "c1"]]),
    ]);
    const created = (
      await d.createAccount({
        localPart: "geewizduck",
        domain: "yourtal.gaiada.com",
        quotaBytes: 2_147_483_648,
      })
    )._unsafeUnwrap();
    expect(created).toStrictEqual({ accountId: "acc-1", login: "geewizduck@yourtal.gaiada.com" });

    const login = loginFor("geewizduck", "yourtal.gaiada.com");
    expect(seen[1]?.body).toMatchObject({
      methodCalls: [
        [
          "x:Account/set",
          {
            create: {
              a: {
                "@type": "User",
                name: "geewizduck",
                domainId: "b",
                credentials: {
                  "0": { "@type": "Password", secret: derivePassword(CREDENTIAL_KEY, login) },
                },
                roles: { "@type": "User" },
                permissions: { "@type": "Inherit" },
                quotas: { maxDiskQuota: 2_147_483_648 },
              },
            },
          },
          "c1",
        ],
      ],
    });
  });

  it("looks the domains up once, not on every account", async () => {
    const created = () => jmap([["x:Account/set", { created: { a: { id: "x" } } }, "c1"]]);
    const { driver: d, seen } = driver([domains(), created(), created()]);
    expect(
      (
        await d.createAccount({
          localPart: "aaaaaa",
          domain: "yourtal.gaiada.com",
          quotaBytes: 1,
        })
      ).isOk(),
    ).toBe(true);
    expect(
      (
        await d.createAccount({
          localPart: "bbbbbb",
          domain: "yourtal.gaiada.com",
          quotaBytes: 1,
        })
      ).isOk(),
    ).toBe(true);
    expect(seen).toHaveLength(3);
  });

  it("answers not_found for a domain Stalwart does not serve, without creating anything", async () => {
    const { driver: d, seen } = driver([domains()]);
    const result = await d.createAccount({
      localPart: "aaaaaa",
      domain: "other.test",
      quotaBytes: 1,
    });
    expect(result._unsafeUnwrapErr().code).toBe("not_found");
    expect(seen).toHaveLength(1);
  });

  it("reports a taken name as already_exists", async () => {
    const { driver: d } = driver([
      domains(),
      jmap([["x:Account/set", { notCreated: { a: { type: "alreadyExists" } } }, "c1"]]),
    ]);
    const result = await d.createAccount({
      localPart: "geewizduck",
      domain: "yourtal.gaiada.com",
      quotaBytes: 1,
    });
    expect(result._unsafeUnwrapErr().code).toBe("already_exists");
  });

  it("destroys an account, and treats one that is already gone as done", async () => {
    const { driver: d, seen } = driver([
      jmap([["x:Account/set", { destroyed: ["acc-1"] }, "c1"]]),
      jmap([["x:Account/set", { notDestroyed: { "acc-2": { type: "notFound" } } }, "c1"]]),
      jmap([["x:Account/set", { notDestroyed: { "acc-3": { type: "forbidden" } } }, "c1"]]),
    ]);
    expect((await d.destroyAccount("acc-1")).isOk()).toBe(true);
    expect((await d.destroyAccount("acc-2")).isOk()).toBe(true);
    expect((await d.destroyAccount("acc-3"))._unsafeUnwrapErr().code).toBe("upstream_auth");
    expect(seen[0]?.body).toMatchObject({
      methodCalls: [["x:Account/set", { destroy: ["acc-1"] }, "c1"]],
    });
  });

  it("creates, lists and revokes app passwords for the account", async () => {
    const { driver: d, seen } = driver([
      jmap([["x:AppPassword/set", { created: { a: { id: "ap-1", secret: "app_abc123" } } }, "c1"]]),
      jmap([
        [
          "x:AppPassword/get",
          { list: [{ id: "ap-1", name: "Pixel mail", createdAt: "2026-11-28T01:00:00Z" }] },
          "c1",
        ],
      ]),
      jmap([["x:AppPassword/set", { destroyed: ["ap-1"] }, "c1"]]),
    ]);
    const created = (await d.createAppPassword("acc-1", "Pixel mail"))._unsafeUnwrap();
    expect(created.secret).toBe("app_abc123");
    expect(created.name).toBe("Pixel mail");
    expect((await d.listAppPasswords("acc-1"))._unsafeUnwrap()).toStrictEqual([
      { id: "ap-1", name: "Pixel mail", createdAt: "2026-11-28T01:00:00Z" },
    ]);
    expect((await d.revokeAppPassword("acc-1", "ap-1")).isOk()).toBe(true);
    // Impersonation: the account is named in the method arguments.
    expect(seen[0]?.body).toMatchObject({
      methodCalls: [
        ["x:AppPassword/set", { accountId: "acc-1", create: { a: { name: "Pixel mail" } } }, "c1"],
      ],
    });
    expect(seen[2]?.body).toMatchObject({
      methodCalls: [["x:AppPassword/set", { accountId: "acc-1", destroy: ["ap-1"] }, "c1"]],
    });
  });

  it("never puts the secret of a created app password or a derived password in a failure", async () => {
    const { driver: d } = driver([
      jmap([["x:AppPassword/set", { created: { a: { id: "ap-1" } } }, "c1"]]),
    ]);
    const failure = (await d.createAppPassword("acc-1", "x"))._unsafeUnwrapErr();
    expect(failure.code).toBe("unavailable");
    expect(JSON.stringify(failure)).not.toContain(derivePassword(CREDENTIAL_KEY, "x"));
  });

  it("maps HTTP and JMAP trouble onto codes", async () => {
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    const { driver: d } = driver([
      new Response("", { status: 401 }),
      new Response("", { status: 503 }),
      new Response("", { status: 400 }),
      new Error("ECONNREFUSED"),
      timeout,
      new Response("<html>", { status: 200 }),
      jmap([["error", { type: "forbidden", description: "no" }, "c1"]]),
    ]);
    const kinds = [];
    for (let i = 0; i < 7; i += 1) kinds.push(await d.listDomains());
    expect(kinds.map((r) => r._unsafeUnwrapErr().code)).toStrictEqual([
      "upstream_auth",
      "unavailable",
      "rejected",
      "unavailable",
      "unavailable",
      "unavailable",
      "upstream_auth",
    ]);
    expect(kinds[4]?._unsafeUnwrapErr().kind).toBe("timeout");
    expect(kinds[4]?._unsafeUnwrapErr().mayHaveSucceeded).toBe(true);
  });
});

describe("as an account", () => {
  const LOGIN = "geewizduck@yourtal.gaiada.com";
  const BASIC = `Basic ${Buffer.from(`${LOGIN}:${derivePassword(CREDENTIAL_KEY, LOGIN)}`).toString("base64")}`;

  it("logs in with the derived credential, never the API key", async () => {
    const { driver: d, seen } = driver([jmap([["Mailbox/get", { list: [] }, "a"]])]);
    const client = d.account("geewizduck", "yourtal.gaiada.com");
    expect(client.login).toBe(LOGIN);
    const result = await client.jmap({ methodCalls: [["Mailbox/get", { accountId: "x" }, "a"]] });
    expect(result._unsafeUnwrap().methodResponses[0]?.[0]).toBe("Mailbox/get");
    expect(seen[0]?.headers.get("authorization")).toBe(BASIC);
    expect(seen[0]?.body).toMatchObject({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    });
  });

  it("leaves a method-level error to the caller", async () => {
    const { driver: d } = driver([jmap([["error", { type: "unknownMethod" }, "a"]])]);
    const result = await d
      .account("geewizduck", "yourtal.gaiada.com")
      .jmap({ methodCalls: [["Nope/get", {}, "a"]] });
    expect(result._unsafeUnwrap().methodResponses[0]?.[0]).toBe("error");
  });

  it("forwards only safe headers, sets the account's credential and the client address", async () => {
    const { driver: d, seen } = driver([new Response("ok")]);
    const result = await d.account("geewizduck", "yourtal.gaiada.com").fetch("/jmap/session", {
      headers: {
        Authorization: "Bearer sbm1.stolen",
        Cookie: "session=1",
        Origin: "https://evil.example",
        "X-Forwarded-For": "6.6.6.6",
        "X-Forwarded-Host": "evil.example",
        Host: "evil.example",
        Accept: "application/json",
      },
      clientIp: "203.0.113.7",
    });
    expect(result.isOk()).toBe(true);
    const sent = seen[0];
    expect(sent?.url).toBe(`${BASE}/jmap/session`);
    expect(sent?.headers.get("authorization")).toBe(BASIC);
    expect(sent?.headers.get("cookie")).toBeNull();
    expect(sent?.headers.get("origin")).toBeNull();
    expect(sent?.headers.get("x-forwarded-host")).toBeNull();
    expect(sent?.headers.get("host")).toBeNull();
    expect(sent?.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(sent?.headers.get("accept")).toBe("application/json");
  });

  it("ignores a client address that is not an IP", async () => {
    const { driver: d, seen } = driver([new Response("ok")]);
    expect(
      (
        await d
          .account("geewizduck", "yourtal.gaiada.com")
          .fetch("/jmap/session", { clientIp: "1.2.3.4, 5.6.7.8" })
      ).isOk(),
    ).toBe(true);
    expect(seen[0]?.headers.get("x-forwarded-for")).toBeNull();
  });

  it("drops set-cookie and www-authenticate from the response", async () => {
    const { driver: d } = driver([
      new Response("body", {
        status: 200,
        headers: { "set-cookie": "a=b", "www-authenticate": "Basic", "content-type": "text/plain" },
      }),
    ]);
    const response = (
      await d.account("geewizduck", "yourtal.gaiada.com").fetch("/jmap/download/a/b/c")
    )._unsafeUnwrap();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("body");
  });

  it("turns an upstream 401 into upstream_auth rather than passing it on", async () => {
    const { driver: d } = driver([
      new Response("", { status: 401, headers: { "www-authenticate": "Basic" } }),
    ]);
    const result = await d.account("geewizduck", "yourtal.gaiada.com").fetch("/jmap/session");
    expect(result._unsafeUnwrapErr().code).toBe("upstream_auth");
  });

  it.each([
    "https://evil.example/x",
    "//evil.example/x",
    "jmap/session",
    "/jmap\\..\\x",
    "/a b",
    "/a\nb",
    "",
  ])("refuses to call %j", async (path) => {
    const { driver: d, seen } = driver([]);
    const result = await d.account("geewizduck", "yourtal.gaiada.com").fetch(path);
    expect(result._unsafeUnwrapErr().code).toBe("rejected");
    expect(seen).toHaveLength(0);
  });
});

describe("resolveUpstream", () => {
  it("stays on the origin", () => {
    expect(resolveUpstream(BASE, "/jmap/download/a/b/c.pdf?accept=application%2Fpdf")).toBe(
      `${BASE}/jmap/download/a/b/c.pdf?accept=application%2Fpdf`,
    );
    expect(resolveUpstream(BASE, "/a/../../b")).toBe(`${BASE}/b`);
    expect(resolveUpstream(BASE, "/@evil.example/x")).toBe(`${BASE}/@evil.example/x`);
  });
});

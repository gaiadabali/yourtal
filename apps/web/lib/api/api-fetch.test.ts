import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * `apiFetch` value-imports `next/headers` (via `session-cookies.ts`), so it
 * needs the same `vi.doMock` + dynamic `import()` pattern as
 * `apps/web/features/region/region-cookie-roundtrip.test.ts` — there is no
 * real Next.js request context in a plain Vitest run.
 */
function mockCookieJar(entries: Record<string, string> = {}) {
  vi.doMock("next/headers", () => ({
    cookies: () =>
      Promise.resolve({
        get: (name: string) => (name in entries ? { value: entries[name] } : undefined),
      }),
  }));
}

async function loadApiFetch(cookieEntries: Record<string, string> = {}) {
  vi.resetModules();
  mockCookieJar(cookieEntries);
  return import("./api-fetch");
}

const echoSchema = z.object({ hello: z.string() });

describe("apiFetch (1.7.a)", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env["API_INTERNAL_URL"];

  beforeEach(() => {
    process.env["API_INTERNAL_URL"] = "http://127.0.0.1:26344";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env["API_INTERNAL_URL"];
    } else {
      process.env["API_INTERNAL_URL"] = originalEnv;
    }
    vi.doUnmock("next/headers");
  });

  it("calls API_INTERNAL_URL and forwards the yt_session cookie as a bearer token", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ hello: "world" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({ yt_session: "session-token-123" });
    const result = await apiFetch("/api/me", echoSchema);

    expect(result).toEqual({ ok: true, data: { hello: "world" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:26344/api/me");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer session-token-123");
  });

  it("sends no authorization header when there is no session cookie", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "anon" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({});
    await apiFetch("/api/me", echoSchema);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).has("authorization")).toBe(false);
  });

  it("an explicit authorization header wins over the cookie (fresh login, before the cookie round-trips)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "fresh" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({ yt_session: "stale-cookie-token" });
    await apiFetch("/api/me", echoSchema, { headers: { authorization: "Bearer fresh-token" } });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get("authorization")).toBe("Bearer fresh-token");
  });

  it("serialises a JSON body and sets content-type", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "posted" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({});
    await apiFetch("/api/auth/login", echoSchema, {
      method: "POST",
      body: { email: "a@example.com", password: "hunter2" },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ email: "a@example.com", password: "hunter2" }));
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("returns a typed http error, reading Nest's {code, message} body shape", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "invalid_credentials", message: "wrong password" }), {
          status: 401,
        }),
      ),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({});
    const result = await apiFetch("/api/auth/login", echoSchema, { method: "POST" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "http", status: 401, code: "invalid_credentials", message: "wrong password" },
    });
  });

  it("falls back to a generic code/message for a non-Nest error body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })));
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({});
    const result = await apiFetch("/api/me", echoSchema);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "http") {
      expect(result.error.status).toBe(502);
      expect(result.error.code).toBe("http_502");
    } else {
      throw new Error("expected an http error");
    }
  });

  it("returns a network error when fetch itself throws", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));

    const { apiFetch } = await loadApiFetch({});
    const result = await apiFetch("/api/me", echoSchema);

    expect(result).toEqual({ ok: false, error: { kind: "network", message: "ECONNREFUSED" } });
  });

  it("returns invalid_response when the body does not match the schema — a contract drift, not a downstream crash", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ somethingElse: 1 }), { status: 200 })),
    );
    global.fetch = fetchMock;

    const { apiFetch } = await loadApiFetch({});
    const result = await apiFetch("/api/me", echoSchema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("throws a clear error when API_INTERNAL_URL is not set, rather than guessing a host", async () => {
    delete process.env["API_INTERNAL_URL"];
    const { apiFetch } = await loadApiFetch({});
    await expect(apiFetch("/api/me", echoSchema)).rejects.toThrow(/API_INTERNAL_URL/);
  });
});

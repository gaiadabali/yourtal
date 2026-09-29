import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { publicApiFetch } from "./public-api-fetch";

const echoSchema = z.object({ hello: z.string() });

describe("publicApiFetch (11.2.a)", () => {
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
  });

  it("never sends an authorization header — this route is always anonymous", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "anon" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    const result = await publicApiFetch("/api/feed", echoSchema, { revalidate: 60 });

    expect(result).toEqual({ ok: true, data: { hello: "anon" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:26344/api/feed");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  it("asks Next's fetch cache to revalidate on the given timer, not cache: no-store", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "world" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    await publicApiFetch("/api/feed", echoSchema, { revalidate: 60 });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit & { next?: { revalidate: number } }];
    expect(init.cache).toBeUndefined();
    expect(init.next).toEqual({ revalidate: 60 });
  });

  it("appends searchParams to the request URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "world" }), { status: 200 })),
    );
    global.fetch = fetchMock;

    await publicApiFetch("/api/feed", echoSchema, {
      searchParams: { region: "AU", surface: "home" },
      revalidate: 60,
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe("http://127.0.0.1:26344/api/feed?region=AU&surface=home");
  });

  it("maps a non-2xx response to an http ApiError instead of throwing", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "not_found", message: "no such campaign" }), {
          status: 404,
        }),
      ),
    );

    const result = await publicApiFetch("/api/campaigns/nope", echoSchema, { revalidate: 60 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "http", status: 404, code: "not_found", message: "no such campaign" },
    });
  });

  it("maps a network failure to a network ApiError instead of throwing", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));

    const result = await publicApiFetch("/api/feed", echoSchema, { revalidate: 60 });

    expect(result).toEqual({ ok: false, error: { kind: "network", message: "ECONNREFUSED" } });
  });

  it("maps a response that fails schema validation to an invalid_response ApiError", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );

    const result = await publicApiFetch("/api/feed", echoSchema, { revalidate: 60 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_response");
    }
  });
});

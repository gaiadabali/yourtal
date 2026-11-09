import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoApi } from "./api-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

describe("DemoApi retries a transient authorization_unavailable", () => {
  it("retries a 503, reusing the idempotency key, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(503, { code: "authorization_unavailable" }))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new DemoApi("http://x").post("/api/auth/login", {});
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    const keys = fetchMock.mock.calls.map(
      (c) => (c[1] as { headers: Record<string, string> }).headers["idempotency-key"],
    );
    expect(keys[0]).toBeDefined();
    expect(keys[0]).toBe(keys[1]);
  });

  it("gives up after the bounded retries and does not retry other errors", async () => {
    vi.useFakeTimers();
    const always = vi
      .fn()
      .mockImplementation(() => Promise.resolve(reply(503, { code: "authorization_unavailable" })));
    vi.stubGlobal("fetch", always);
    const pending = new DemoApi("http://x").get("/a");
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(always).toHaveBeenCalledTimes(4);
    const bad = vi.fn().mockImplementation(() => Promise.resolve(reply(500, {})));
    vi.stubGlobal("fetch", bad);
    expect((await new DemoApi("http://x").get("/a")).status).toBe(500);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

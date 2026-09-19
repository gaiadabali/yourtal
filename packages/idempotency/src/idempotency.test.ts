import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "./in-memory-store";
import { REDEMPTION_RETENTION_MS, abandon, begin, complete } from "./idempotency";
import type { BeginRequest } from "./idempotency";

const SCOPE = "mer_kopi_kenangan";
const KEY = "0199f0c2-0000-7000-8000-000000000001";
const AT = new Date("2026-09-19T10:00:00Z");

let store: InMemoryIdempotencyStore;

beforeEach(() => {
  store = new InMemoryIdempotencyStore();
});

function request(over: Partial<BeginRequest> = {}): BeginRequest {
  return {
    scope: SCOPE,
    key: KEY,
    method: "POST",
    path: "/v1/redemptions",
    rawBody: '{"code":"VCH-1","amount":45000}',
    startedAt: AT,
    retentionMs: REDEMPTION_RETENTION_MS,
    ...over,
  };
}

describe("the first request", () => {
  it("proceeds", async () => {
    expect(await begin(store, request())).toEqual({ kind: "proceed" });
  });

  it("claims the key before the operation runs", async () => {
    // The record must exist DURING the operation, not after it. Writing it
    // on completion leaves the timeout window — exactly when clients retry —
    // wide open for a second execution.
    await begin(store, request());
    expect(store.size).toBe(1);
    expect(await begin(store, request())).toEqual({ kind: "in_progress" });
  });
});

describe("replay", () => {
  it("returns the stored response verbatim without re-executing", async () => {
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 201, body: '{"redemption_id":"rdm_1"}' });

    expect(await begin(store, request())).toEqual({
      kind: "replay",
      status: 201,
      body: '{"redemption_id":"rdm_1"}',
    });
  });

  it("replays a stored 5xx rather than retrying the operation", async () => {
    // docs/12 caches 500s deliberately. If a value operation failed after
    // partially executing, re-running it because the client retried is how a
    // partial failure becomes a double charge. The client's retry budget is
    // not a reason to charge someone twice.
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 500, body: '{"error":{"type":"api_error"}}' });

    expect(await begin(store, request())).toMatchObject({ kind: "replay", status: 500 });
  });
});

describe("same key, different request", () => {
  it("is a mismatch, never a replay", async () => {
    // The dangerous failure: returning the FIRST request's response for the
    // SECOND request's parameters. A wrong answer with a 200 — nothing logs,
    // nothing alerts, and a merchant is told a redemption succeeded that
    // never happened.
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 201, body: '{"redemption_id":"rdm_1"}' });

    const outcome = await begin(store, request({ rawBody: '{"code":"VCH-1","amount":9900000}' }));
    expect(outcome).toEqual({ kind: "fingerprint_mismatch" });
  });

  it.each([
    ["a different path", { path: "/v1/redemptions/rdm_1/capture" }],
    ["a different method", { method: "DELETE" }],
    ["a re-serialised body", { rawBody: '{"amount":45000,"code":"VCH-1"}' }],
  ])("detects %s", async (_label, over) => {
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 201, body: "{}" });

    expect(await begin(store, request(over))).toEqual({ kind: "fingerprint_mismatch" });
  });

  it("reports a mismatch even while the first request is still running", async () => {
    // Checked before the state on purpose: a mismatched request will never
    // be accepted, so telling the client "try again later" sends them into a
    // retry loop over a request they need to fix instead.
    await begin(store, request());

    expect(await begin(store, request({ rawBody: "{}" }))).toEqual({
      kind: "fingerprint_mismatch",
    });
  });
});

describe("scoping", () => {
  it("does not let one scope read another's response", async () => {
    // Unscoped keys leak across tenants: two merchants legitimately pick the
    // same key and the second silently receives the first one's response.
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 201, body: '{"secret":"kopi"}' });

    expect(await begin(store, request({ scope: "mer_rival" }))).toEqual({ kind: "proceed" });
  });

  it("keeps identical keys in different scopes independent", async () => {
    await begin(store, request());
    await begin(store, request({ scope: "mer_rival" }));
    expect(store.size).toBe(2);
  });

  it("does not collide when a scope or key contains the separator", async () => {
    // scope "a:b" + key "c" and scope "a" + key "b:c" must not be one row.
    await begin(store, request({ scope: "a:b", key: "c" }));
    await begin(store, request({ scope: "a", key: "b:c" }));
    expect(store.size).toBe(2);
  });
});

describe("abandon", () => {
  it("leaves a validation failure retryable", async () => {
    // docs/12: a request that failed validation is not saved and is safe to
    // retry. Storing it would mean a client correcting the very mistake we
    // reported then gets fingerprint_mismatch for the corrected body.
    await begin(store, request());
    await abandon(store, SCOPE, KEY);

    expect(await begin(store, request({ rawBody: '{"code":"VCH-1","amount":45001}' }))).toEqual({
      kind: "proceed",
    });
  });

  it("frees the key for the identical request too", async () => {
    await begin(store, request());
    await abandon(store, SCOPE, KEY);
    expect(await begin(store, request())).toEqual({ kind: "proceed" });
  });
});

describe("expiry", () => {
  it("treats an expired claim as absent", async () => {
    // An expired row must not wedge a legitimate retry by reporting
    // "in progress" from a request that died a day ago.
    await begin(store, request());

    const later = new Date(AT.getTime() + REDEMPTION_RETENTION_MS + 1);
    expect(await begin(store, request({ startedAt: later }))).toEqual({ kind: "proceed" });
  });

  it("still replays inside the retention window", async () => {
    await begin(store, request());
    await complete(store, SCOPE, KEY, { status: 201, body: "{}" });

    const later = new Date(AT.getTime() + REDEMPTION_RETENTION_MS - 1000);
    expect(await begin(store, request({ startedAt: later }))).toMatchObject({ kind: "replay" });
  });

  it("prunes only what has expired", async () => {
    await begin(store, request());
    await begin(store, request({ key: "second", retentionMs: REDEMPTION_RETENTION_MS * 10 }));

    const removed = await store.prune(new Date(AT.getTime() + REDEMPTION_RETENTION_MS + 1));
    expect(removed).toBe(1);
    expect(store.size).toBe(1);
  });
});

describe("misuse", () => {
  it("refuses to complete a record nobody claimed", async () => {
    // A broken begin/complete pairing must fail loudly rather than write a
    // record whose fingerprint nothing ever checked.
    await expect(complete(store, SCOPE, KEY, { status: 200, body: "{}" })).rejects.toThrow(
      /does not exist/,
    );
  });

  it.each([
    ["an empty key", { key: "" }],
    ["a key over 255 characters", { key: "k".repeat(256) }],
    ["an empty scope", { scope: "" }],
  ])("rejects %s", async (_label, over) => {
    await expect(begin(store, request(over))).rejects.toThrow();
  });
});

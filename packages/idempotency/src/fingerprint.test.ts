import { describe, expect, it } from "vitest";
import { requestFingerprint } from "./fingerprint";

describe("requestFingerprint", () => {
  it("is stable for the same request", () => {
    const a = requestFingerprint("POST", "/v1/redemptions", '{"code":"VCH-1"}');
    const b = requestFingerprint("POST", "/v1/redemptions", '{"code":"VCH-1"}');
    expect(a).toBe(b);
  });

  it("is a 64-character hex sha256", () => {
    expect(requestFingerprint("POST", "/v1/redemptions", "{}")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pins the canonical form, which is a cross-language wire contract", () => {
    // The Go services (docs/15: ledger, pricing, voucher, redemption) must
    // compute byte-identical fingerprints, or a retry that lands on a Go
    // instance looks like a fingerprint mismatch and a legitimate client is
    // told to fix a request that was never wrong.
    //
    // The canonical string is: METHOD \n path \n sha256(body)
    // For POST /v1/redemptions with an empty body that is:
    //   sha256("POST\n/v1/redemptions\ne3b0c442...b7852b855")
    // where the inner digest is sha256 of the empty string.
    //
    // This expected value is therefore part of the contract. If a change
    // makes this test fail, the change is wrong — not the test.
    expect(requestFingerprint("POST", "/v1/redemptions", "")).toBe(
      "3b6c3e7b787c6aeb54e621cd18c4236472e76fd72d542ee12dfd1a6120f761f0",
    );
  });

  it.each([
    ["the method", ["GET", "/v1/redemptions", "{}"] as const],
    ["the path", ["POST", "/v1/refunds", "{}"] as const],
    ["the body", ["POST", "/v1/redemptions", '{"a":1}'] as const],
  ])("changes with %s", (_label, [method, path, body]) => {
    const base = requestFingerprint("POST", "/v1/redemptions", "{}");
    expect(requestFingerprint(method, path, body)).not.toBe(base);
  });

  it("treats the method case-insensitively", () => {
    expect(requestFingerprint("post", "/v1/x", "{}")).toBe(
      requestFingerprint("POST", "/v1/x", "{}"),
    );
  });

  it("distinguishes a re-serialised body", () => {
    // Hashing raw bytes is stricter than canonical JSON would be, and never
    // wrong. A client that re-serialises differently between retries gets a
    // 409 telling them exactly what to fix, rather than a silent mismatch —
    // and we avoid canonical-JSON, a notorious cross-language disagreement.
    expect(requestFingerprint("POST", "/v1/x", '{"a":1,"b":2}')).not.toBe(
      requestFingerprint("POST", "/v1/x", '{"b":2,"a":1}'),
    );
  });

  it("does not confuse a path change for a body change", () => {
    // The separator matters: without it, ("/v1/ab", "c") and ("/v1/a", "bc")
    // could canonicalise identically.
    expect(requestFingerprint("POST", "/v1/ab", "c")).not.toBe(
      requestFingerprint("POST", "/v1/a", "bc"),
    );
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signStripePayload, verifyStripeSignature } from "./stripe-signature";

const SECRET = "whsec_test_secret";
const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1_000;
const BODY = '{"id":"evt_1","object":"event","type":"payment_intent.succeeded"}';

function v1(body: string, secret: string, t: number): string {
  return createHmac("sha256", secret)
    .update(`${String(t)}.${body}`)
    .digest("hex");
}

const verify = (header: string | undefined, rawBody = BODY, nowMs = NOW_MS) =>
  verifyStripeSignature({ rawBody, header, secret: SECRET, nowMs });

describe("Stripe-Signature verification", () => {
  it("accepts a genuine signature, signed exactly as Stripe documents", () => {
    const header = signStripePayload(BODY, SECRET, NOW_S);
    expect(header).toBe(`t=${String(NOW_S)},v1=${v1(BODY, SECRET, NOW_S)}`);
    expect(verify(header).isOk()).toBe(true);
  });

  it("refuses a tampered body", () => {
    const header = signStripePayload(BODY, SECRET, NOW_S);
    expect(verify(header, BODY.replace("succeeded", "failed"))._unsafeUnwrapErr().kind).toBe(
      "bad_signature",
    );
  });

  it("refuses a signature made with the wrong secret", () => {
    expect(verify(signStripePayload(BODY, "whsec_other", NOW_S))._unsafeUnwrapErr().kind).toBe(
      "bad_signature",
    );
  });

  it("refuses a signature whose timestamp was rewritten", () => {
    const genuine = v1(BODY, SECRET, NOW_S);
    expect(verify(`t=${String(NOW_S + 1)},v1=${genuine}`)._unsafeUnwrapErr().kind).toBe(
      "bad_signature",
    );
  });

  it("refuses a stale one, beyond 300 s", () => {
    const t = NOW_S - 301;
    const failure = verify(signStripePayload(BODY, SECRET, t))._unsafeUnwrapErr();
    expect(failure).toStrictEqual({ kind: "stale_timestamp", ageMs: 301_000 });
    expect(verify(signStripePayload(BODY, SECRET, NOW_S - 300)).isOk()).toBe(true);
  });

  it("refuses one from the future, beyond 300 s", () => {
    const failure = verify(signStripePayload(BODY, SECRET, NOW_S + 301))._unsafeUnwrapErr();
    expect(failure).toStrictEqual({ kind: "future_timestamp", aheadMs: 301_000 });
    expect(verify(signStripePayload(BODY, SECRET, NOW_S + 300)).isOk()).toBe(true);
  });

  it("accepts any matching v1 among several (a secret being rolled), and ignores v0", () => {
    const header = `t=${String(NOW_S)},v1=${v1(BODY, "whsec_old", NOW_S)},v0=abc,v1=${v1(BODY, SECRET, NOW_S)}`;
    expect(verify(header).isOk()).toBe(true);
    const none = `t=${String(NOW_S)},v1=${v1(BODY, "whsec_old", NOW_S)},v0=${v1(BODY, SECRET, NOW_S)}`;
    expect(verify(none)._unsafeUnwrapErr().kind).toBe("bad_signature");
  });

  const malformed = [
    { header: undefined, kind: "missing_signature" },
    { header: "", kind: "missing_signature" },
    { header: "garbage", kind: "missing_timestamp" },
    { header: `v1=${"a".repeat(64)}`, kind: "missing_timestamp" },
    { header: `t=,v1=${"a".repeat(64)}`, kind: "missing_timestamp" },
    { header: `t=12.5,v1=${"a".repeat(64)}`, kind: "malformed_timestamp" },
    { header: `t=-5,v1=${"a".repeat(64)}`, kind: "malformed_timestamp" },
    { header: `t=1e9,v1=${"a".repeat(64)}`, kind: "malformed_timestamp" },
    { header: `t=${String(NOW_S)}`, kind: "missing_signature" },
    { header: `t=${String(NOW_S)},v1=`, kind: "missing_signature" },
    { header: `t=${String(NOW_S)},v1=short`, kind: "bad_signature" },
    { header: `t=${String(NOW_S)},v1=${"é".repeat(64)}`, kind: "bad_signature" },
    { header: ",,,=,==", kind: "missing_timestamp" },
  ];
  it.each(malformed)("refuses $header as $kind, without throwing", ({ header, kind }) => {
    expect(() => verify(header)).not.toThrow();
    expect(verify(header)._unsafeUnwrapErr().kind).toBe(kind);
  });
});

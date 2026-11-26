import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAIL_TOKEN_TTL_SECONDS } from "@yourtal/contracts/spambank/common";
import { signMailToken, verifyMailToken } from "./mail-token";

const KEY = "token-key-token-key-token-key-token-key!";
const OTHER_KEY = "other-key-other-key-other-key-other-key";
const MAILBOX = "6f0f8a5e-2b7c-4a43-9d1e-0c5b7e2a9f10";
const NOW = 1_800_000_000_000;

function mint(overrides: Partial<Parameters<typeof signMailToken>[0]> = {}) {
  return signMailToken(
    { mailboxId: MAILBOX, userId: "user-1", app: "snapapp", now: NOW, ...overrides },
    KEY,
  );
}

/** A token whose payload is whatever the caller wrote, validly signed with `key`. */
function signed(payload: unknown, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `sbm1.${body}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}

describe("mail token", () => {
  it("round-trips the mailbox, the person and the app", () => {
    const { token, expiresAt } = mint();
    expect(token).toMatch(/^sbm1\.[\w-]+\.[\w-]{43}$/);
    expect(expiresAt.getTime()).toBe(NOW + MAIL_TOKEN_TTL_SECONDS * 1000);
    expect(verifyMailToken(token, KEY, NOW + 1000)).toMatchObject({
      ok: true,
      payload: { v: 1, m: MAILBOX, u: "user-1", a: "snapapp", exp: NOW / 1000 + 1800 },
    });
  });

  it("lasts 30 minutes by default and expires exactly then", () => {
    const { token } = mint();
    expect(verifyMailToken(token, KEY, NOW + 1_799_999).ok).toBe(true);
    expect(verifyMailToken(token, KEY, NOW + 1_800_000)).toStrictEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is different every time (a fresh nonce)", () => {
    expect(mint().token).not.toBe(mint().token);
  });

  it("refuses the wrong key", () => {
    expect(verifyMailToken(mint().token, OTHER_KEY, NOW)).toStrictEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a tampered payload, whatever it claims", () => {
    const [prefix, body, signature] = mint().token.split(".");
    const payload = JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    for (const changed of [
      { ...payload, m: "11111111-2222-4333-8444-555555555555" },
      { ...payload, exp: 9_999_999_999 },
      { ...payload, a: "ftr" },
    ]) {
      const other = Buffer.from(JSON.stringify(changed)).toString("base64url");
      expect(verifyMailToken(`${prefix}.${other}.${signature}`, KEY, NOW)).toStrictEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });

  it("refuses a flipped, truncated or extended signature", () => {
    const { token } = mint();
    const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifyMailToken(flipped, KEY, NOW).ok).toBe(false);
    expect(verifyMailToken(token.slice(0, -1), KEY, NOW)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(verifyMailToken(`${token}A`, KEY, NOW)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it.each([
    "",
    "sbm1",
    "sbm1.",
    "sbm1..",
    "sbm2.eyJ2IjoxfQ.AAAA",
    "a.b",
    "a.b.c.d",
    "not a token",
    `sbm1.${"x".repeat(2000)}.${"A".repeat(43)}`,
  ])("refuses %j as malformed", (token) => {
    expect(verifyMailToken(token, KEY, NOW)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("refuses a validly signed payload that is not a mail token", () => {
    const good = {
      v: 1,
      m: MAILBOX,
      u: "u",
      a: "snapapp",
      exp: NOW / 1000 + 60,
      n: "A".repeat(22),
    };
    expect(verifyMailToken(signed(good, KEY), KEY, NOW).ok).toBe(true);
    for (const bad of [
      { ...good, v: 2 },
      { ...good, a: "admin" },
      { ...good, m: "not-a-uuid" },
      { ...good, exp: "soon" },
      { ...good, n: "short" },
      { ...good, extra: 1 },
      "a string",
      null,
    ]) {
      expect(verifyMailToken(signed(bad, KEY), KEY, NOW)).toStrictEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("accepts nothing but the HMAC of the exact signing input", () => {
    const [, body] = mint().token.split(".");
    expect(verifyMailToken(`sbm1.${body}.`, KEY, NOW).ok).toBe(false);
    expect(verifyMailToken(`sbm1.${body}.${"A".repeat(43)}`, KEY, NOW)).toMatchObject({
      reason: "bad_signature",
    });
  });

  it("refuses to sign or verify with a short key", () => {
    expect(() => signMailToken({ mailboxId: MAILBOX, userId: "u", app: "ftr" }, "short")).toThrow(
      /32/,
    );
    expect(() => verifyMailToken(mint().token, "", NOW)).toThrow(/32/);
  });

  it("carries each app the proxy distinguishes", () => {
    for (const app of ["yourtal", "snapapp", "ftr"] as const) {
      const verified = verifyMailToken(mint({ app }).token, KEY, NOW);
      expect(verified.ok && verified.payload.a).toBe(app);
    }
  });
});

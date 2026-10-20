import { describe, expect, it } from "vitest";
import { Secret } from "otpauth";
import { openSecret, sealSecret } from "./sealed-secret";
import { generateTotpSeed, matchTotpCode, totpCodeAt, totpUri } from "./totp-code";

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SEED = Secret.fromLatin1("12345678901234567890").base32;
const at = (seconds: number) => new Date(seconds * 1000);

describe("authenticator codes (RFC 6238, SHA-1, 6 digits, 30 s)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC's vector at t=%i", (seconds, code) => {
    expect(totpCodeAt(RFC_SEED, at(seconds))).toBe(code);
    expect(matchTotpCode(RFC_SEED, code, at(seconds))).toBe(Math.floor(seconds / 30));
  });

  it("accepts one step of clock drift either way, and no more", () => {
    const now = 1234567890;
    const step = Math.floor(now / 30);
    expect(matchTotpCode(RFC_SEED, totpCodeAt(RFC_SEED, at(now - 30)), at(now))).toBe(step - 1);
    expect(matchTotpCode(RFC_SEED, totpCodeAt(RFC_SEED, at(now + 30)), at(now))).toBe(step + 1);
    expect(matchTotpCode(RFC_SEED, totpCodeAt(RFC_SEED, at(now - 60)), at(now))).toBeNull();
    expect(matchTotpCode(RFC_SEED, totpCodeAt(RFC_SEED, at(now + 60)), at(now))).toBeNull();
  });

  it("refuses a wrong code and anything that is not six digits", () => {
    const now = at(1234567890);
    expect(matchTotpCode(RFC_SEED, "005925", now)).toBeNull();
    expect(matchTotpCode(RFC_SEED, "5924", now)).toBeNull();
    expect(matchTotpCode(RFC_SEED, "00592a", now)).toBeNull();
    expect(matchTotpCode(RFC_SEED, " 005924", now)).toBeNull();
  });

  it("makes a 160-bit seed and a URI an authenticator app reads", () => {
    const seed = generateTotpSeed();
    expect(seed).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSeed()).not.toBe(seed);
    const uri = new URL(totpUri(seed, "ana@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe(seed);
    expect(uri.searchParams.get("issuer")).toBe("YourTal");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
  });
});

describe("sealed seeds", () => {
  const key = "test-only-totp-secret-encryption-key-not-real";

  it("round-trips, and never stores the seed in the clear", () => {
    const sealed = sealSecret(RFC_SEED, key, "user-1");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(RFC_SEED);
    expect(openSecret(sealed, key, "user-1")).toBe(RFC_SEED);
    expect(sealSecret(RFC_SEED, key, "user-1")).not.toBe(sealed);
  });

  it("does not open with another key, for another account, or after tampering", () => {
    const sealed = sealSecret(RFC_SEED, key, "user-1");
    expect(() => openSecret(sealed, `${key}-other`, "user-1")).toThrow();
    expect(() => openSecret(sealed, key, "user-2")).toThrow();
    const [version, nonce, body] = sealed.split(".");
    const flipped = Buffer.from(body ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      openSecret(`${version}.${nonce}.${flipped.toString("base64url")}`, key, "user-1"),
    ).toThrow();
    expect(() => openSecret("v2.a.b", key, "user-1")).toThrow();
  });
});

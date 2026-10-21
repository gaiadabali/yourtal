import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cookieKeysPathFor, loadProviderKeys } from "./keys";

const JWKS_PATH = path.join("/opt/yourtal/secrets/oidc", "jwks.json");
const COOKIES_PATH = cookieKeysPathFor(JWKS_PATH);

function files(contents: Record<string, string>) {
  return {
    exists: (file: string) => file in contents,
    read: (file: string) => contents[file] ?? "",
  };
}

function privateJwks(...kids: string[]): string {
  return JSON.stringify({
    keys: kids.map((kid) => ({
      ...generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" }),
      kid,
    })),
  });
}

const COOKIES = JSON.stringify({ keys: ["c".repeat(43), "d".repeat(43)] });

describe("signing and cookie keys (docs/26 §1.8)", () => {
  it("the cookie keys sit beside the JWKS", () => {
    expect(COOKIES_PATH).toBe(path.join("/opt/yourtal/secrets/oidc", "cookie-keys.json"));
  });

  it("dev makes throwaway keys when both files are missing, and says so once", () => {
    const log = vi.fn();
    const keys = loadProviderKeys({ appEnv: "dev", jwksPath: JWKS_PATH }, log, files({}));
    expect(keys.ephemeral).toBe(true);
    expect(keys.jwks.keys).toHaveLength(1);
    expect(keys.jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(keys.cookieKeys[0]?.length).toBeGreaterThanOrEqual(32);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each(["staging", "production"] as const)("%s refuses to start without the files", (appEnv) => {
    expect(() => loadProviderKeys({ appEnv, jwksPath: JWKS_PATH }, vi.fn(), files({}))).toThrow(
      /signing keys not found/,
    );
    expect(() =>
      loadProviderKeys(
        { appEnv, jwksPath: JWKS_PATH },
        vi.fn(),
        files({ [JWKS_PATH]: privateJwks("a") }),
      ),
    ).toThrow(/cookie keys not found/);
  });

  it("reads both files, keeping their order: the first key signs", () => {
    const keys = loadProviderKeys(
      { appEnv: "staging", jwksPath: JWKS_PATH },
      vi.fn(),
      files({ [JWKS_PATH]: privateJwks("2026-10-a", "2026-10-b"), [COOKIES_PATH]: COOKIES }),
    );
    expect(keys.ephemeral).toBe(false);
    expect(keys.jwks.keys.map((key) => key.kid)).toEqual(["2026-10-a", "2026-10-b"]);
    expect(keys.cookieKeys).toEqual(["c".repeat(43), "d".repeat(43)]);
  });

  it("refuses a JWKS of public keys, keys without a kid, and keys for another algorithm", () => {
    const pub = JSON.stringify({
      keys: [
        {
          ...generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
            format: "jwk",
          }),
          kid: "x",
        },
      ],
    });
    const noKid = JSON.stringify({
      keys: [
        generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" }),
      ],
    });
    const ps256 = JSON.stringify({
      keys: [{ ...JSON.parse(privateJwks("y")).keys[0], alg: "PS256" }],
    });
    for (const jwks of [pub, noKid, ps256, JSON.stringify({ keys: [] })]) {
      expect(() =>
        loadProviderKeys(
          { appEnv: "staging", jwksPath: JWKS_PATH },
          vi.fn(),
          files({ [JWKS_PATH]: jwks, [COOKIES_PATH]: COOKIES }),
        ),
      ).toThrow();
    }
  });

  it("never echoes a malformed key file into the error", () => {
    const run = () =>
      loadProviderKeys(
        { appEnv: "staging", jwksPath: JWKS_PATH },
        vi.fn(),
        files({ [JWKS_PATH]: '{"keys":[{"d":"SECRETFRAGMENT', [COOKIES_PATH]: COOKIES }),
      );
    expect(run).toThrow(new Error(`oidc: ${JWKS_PATH} is not valid JSON`));
    try {
      run();
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("refuses short or missing cookie keys", () => {
    for (const cookies of [
      JSON.stringify({ keys: ["short"] }),
      JSON.stringify({ keys: [] }),
      "{}",
    ]) {
      expect(() =>
        loadProviderKeys(
          { appEnv: "staging", jwksPath: JWKS_PATH },
          vi.fn(),
          files({ [JWKS_PATH]: privateJwks("a"), [COOKIES_PATH]: cookies }),
        ),
      ).toThrow(/cookie/);
    }
  });
});

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { JWK } from "oidc-provider";
import type { AppConfig } from "../../config/app-config";

/**
 * docs/26 §1.8: RS256 signing keys from a JWKS file, and the provider's
 * cookie-signing keys from `cookie-keys.json` beside it. Never env values.
 * The first key in each file signs; the rest only verify, which is what lets
 * `scripts/oidc-keys.mjs` rotate with overlap.
 */
export interface ProviderKeys {
  readonly jwks: { readonly keys: JWK[] };
  readonly cookieKeys: string[];
  /** True when made at boot because the files were missing (dev only). */
  readonly ephemeral: boolean;
}

export const COOKIE_KEYS_FILE = "cookie-keys.json";

export function cookieKeysPathFor(jwksPath: string): string {
  return path.join(path.dirname(jwksPath), COOKIE_KEYS_FILE);
}

interface KeyFiles {
  readonly exists: (file: string) => boolean;
  readonly read: (file: string) => string;
}

const DISK: KeyFiles = { exists: existsSync, read: (file) => readFileSync(file, "utf8") };

/**
 * JSON.parse's own message quotes the text near the fault, which for a key
 * file is key material. So the error names the file and nothing else.
 */
export function parseSecretJson(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`oidc: ${file} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSigningKeys(raw: string, file: string): JWK[] {
  const parsed = parseSecretJson(raw, file);
  const keys = isRecord(parsed) ? parsed["keys"] : undefined;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`oidc: ${file} has no keys`);
  return keys.map((key: unknown, index) => {
    if (
      !isRecord(key) ||
      key["kty"] !== "RSA" ||
      typeof key["kid"] !== "string" ||
      typeof key["d"] !== "string"
    ) {
      throw new Error(`oidc: key ${String(index)} in ${file} is not an RSA private key with a kid`);
    }
    if (key["alg"] !== undefined && key["alg"] !== "RS256") {
      throw new Error(`oidc: key ${key["kid"]} in ${file} is not RS256`);
    }
    return { ...key, alg: "RS256", use: "sig" };
  });
}

function parseCookieKeys(raw: string, file: string): string[] {
  const parsed = parseSecretJson(raw, file);
  const keys = isRecord(parsed) ? parsed["keys"] : undefined;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    !keys.every((key): key is string => typeof key === "string" && key.length >= 32)
  ) {
    throw new Error(`oidc: ${file} needs a "keys" list of strings of 32 characters or more`);
  }
  return keys;
}

function ephemeralKeys(): ProviderKeys {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" });
  const kid = `ephemeral-${randomBytes(4).toString("hex")}`;
  return {
    jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] },
    cookieKeys: [randomBytes(32).toString("base64url")],
    ephemeral: true,
  };
}

/**
 * Staging and production refuse to boot without both files. Dev (and the
 * tests, which run as dev) make throwaway keys instead and say so once.
 */
export function loadProviderKeys(
  config: Pick<AppConfig, "appEnv"> & { readonly jwksPath: string },
  log: (message: string) => void,
  files: KeyFiles = DISK,
): ProviderKeys {
  const cookiePath = cookieKeysPathFor(config.jwksPath);
  const haveJwks = files.exists(config.jwksPath);
  const haveCookies = files.exists(cookiePath);

  if (!haveJwks && !haveCookies && config.appEnv === "dev") {
    log("no OIDC keys on disk: using throwaway keys made at boot (dev only)");
    return ephemeralKeys();
  }
  if (!haveJwks) throw new Error(`oidc: signing keys not found at ${config.jwksPath}`);
  if (!haveCookies) throw new Error(`oidc: cookie keys not found at ${cookiePath}`);

  return {
    jwks: { keys: parseSigningKeys(files.read(config.jwksPath), config.jwksPath) },
    cookieKeys: parseCookieKeys(files.read(cookiePath), cookiePath),
    ephemeral: false,
  };
}

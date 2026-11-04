import { createHash } from "node:crypto";
import { CompactEncrypt, SignJWT, importJWK } from "jose";
import type { JWK } from "oidc-provider";
import type { OperatedApp, Region, TransferRoute } from "./clients";

/** docs/30 §4: neither an ID token nor a SET verifies as this, nor this as either. */
export const TRANSFER_JWT_TYPE = "transfer+jwt";

/** Everything in the assertion but `iss`, which the signer adds. */
export interface TransferClaims {
  readonly aud: string;
  readonly azp: string;
  /** The destination's own pairwise `sub`. */
  readonly sub: string;
  /** The transfer id. */
  readonly jti: string;
  /** The approval. */
  readonly iat: number;
  /** The transfer's end: at most 15 minutes after it opened. */
  readonly exp: number;
  readonly region: Region;
  readonly age_band: "adult";
  readonly kind: TransferRoute["kind"];
  readonly source: OperatedApp;
  readonly financial_year: string;
  readonly bundle_sha256: string;
}

/** Signs, then encrypts to the destination with the key from its client secret. */
export type TransferSigner = (claims: TransferClaims, destinationSecret: string) => Promise<string>;

/** The A256GCM key: SHA-256 of the client secret, as OIDC Core §10.2 derives one. */
export function destinationKey(clientSecret: string): Uint8Array {
  return createHash("sha256").update(clientSecret, "utf8").digest();
}

/** RS256 with the provider's signing key (the JWKS file's first), then a compact `dir` JWE. */
export function transferSigner(issuer: string, signingKey: JWK): TransferSigner {
  const kid = signingKey.kid;
  if (signingKey.kty !== "RSA" || typeof kid !== "string") {
    throw new Error("oidc: the signing key is not an RSA key with a kid");
  }
  // Imported on first use, so a bad key fails that call rather than as an unhandled rejection at boot.
  let key: ReturnType<typeof importJWK> | undefined;
  return async (claims, destinationSecret) => {
    const signed = await new SignJWT({ iss: issuer, ...claims })
      .setProtectedHeader({ alg: "RS256", typ: TRANSFER_JWT_TYPE, kid })
      .sign(
        await (key ??= importJWK(
          { ...signingKey, alg: "RS256" } as Parameters<typeof importJWK>[0],
          "RS256",
        )),
      );
    return new CompactEncrypt(new TextEncoder().encode(signed))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", cty: "JWT" })
      .encrypt(destinationKey(destinationSecret));
  };
}

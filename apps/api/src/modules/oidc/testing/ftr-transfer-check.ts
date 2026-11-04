import { createHash } from "node:crypto";
import { compactDecrypt, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

/**
 * Test-only: FTR's own opening of a transfer assertion, copied from its
 * `src/lib/yourtal-transfer.ts` (`open`, group 4.8 F1) so a change on either
 * side shows here. Keep it in step with FTR's file; never loosen it.
 */
const MAX_LIFETIME_S = 15 * 60;
const MAX_AHEAD_S = 60;

export type FtrCheck =
  | {
      readonly ok: true;
      readonly sub: string;
      readonly jti: string;
      readonly financialYear: string;
      readonly bundleSha256: string;
    }
  | { readonly ok: false; readonly err: "invalid_token" | "not_allowed" };

export async function ftrOpenTransfer(
  token: string,
  issuer: string,
  clientId: string,
  rawSecret: string,
  getKey: JWTVerifyGetKey,
): Promise<FtrCheck> {
  const invalid = { ok: false, err: "invalid_token" } as const;
  // FTR trims its env value.
  const secret = rawSecret.trim();
  let payload: Record<string, unknown>;
  try {
    const key = createHash("sha256").update(secret).digest();
    const { plaintext, protectedHeader } = await compactDecrypt(token, key, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      // FTR refuses a compressed token.
      maxDecompressedLength: 0,
    });
    if (protectedHeader.cty !== "JWT") return invalid;
    ({ payload } = await jwtVerify(new TextDecoder().decode(plaintext), getKey, {
      issuer,
      audience: clientId,
      typ: "transfer+jwt",
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "jti", "sub"],
    }));
  } catch {
    return invalid;
  }
  const { sub, jti, iat, exp, aud, region, age_band, kind, source, financial_year, bundle_sha256 } =
    payload;
  const now = Date.now() / 1000;
  // `aud` a string, not a list: FTR's contract note.
  if (aud !== clientId) return invalid;
  if (
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    iat > now + MAX_AHEAD_S ||
    exp <= iat ||
    exp - iat > MAX_LIFETIME_S
  ) {
    return invalid;
  }
  if (typeof sub !== "string" || !sub || sub.length > 255) return invalid;
  if (typeof jti !== "string" || !jti || jti.length > 255) return invalid;
  if (
    kind !== "deduction-bundle-v1" ||
    source !== "snapapp" ||
    typeof financial_year !== "string"
  ) {
    return invalid;
  }
  if (typeof bundle_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(bundle_sha256)) return invalid;
  if (region !== "AU" || age_band !== "adult") return { ok: false, err: "not_allowed" };
  return { ok: true, sub, jti, financialYear: financial_year, bundleSha256: bundle_sha256 };
}

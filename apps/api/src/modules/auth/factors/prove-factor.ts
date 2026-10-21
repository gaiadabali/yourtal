import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { err } from "neverthrow";
import type { Result } from "neverthrow";
import type { FactorError } from "./factor.errors";
import type { PasskeyService } from "./passkey.service";
import type { TotpService } from "./totp.service";

/** A code from the app, or a passkey answer to a step-up challenge. */
export interface FactorProof {
  readonly code?: string | undefined;
  readonly challengeId?: string | undefined;
  readonly response?: unknown;
}

/** Checks a proof of one of the account's own factors; a body with neither is refused. */
export async function proveFactor(
  totp: TotpService,
  passkeys: PasskeyService,
  userId: string,
  proof: FactorProof,
  now: Date,
): Promise<Result<unknown, FactorError>> {
  if (proof.code !== undefined) return totp.verify(userId, proof.code, now);
  if (proof.challengeId !== undefined && proof.response !== undefined) {
    const response = proof.response as AuthenticationResponseJSON;
    return passkeys.stepUp(userId, proof.challengeId, response, now);
  }
  return err({ type: "factor_invalid" });
}

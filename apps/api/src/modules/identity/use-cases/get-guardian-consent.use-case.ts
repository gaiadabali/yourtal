import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { GuardianConsentView } from "@yourtal/contracts/identity/guardian";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import {
  guardianConsentStatusOf,
  type GuardianConsentRepository,
} from "../persistence/guardian-consent.repository";
import type { UserProfileRepository } from "../persistence/user-profile.repository";
import type { GetGuardianConsentError } from "../guardian-consent.errors";

/**
 * `GET /api/guardian/:token` (12.1.a). Deliberately hands back only
 * `status`/`displayName`/`region`/`locale` — no date of birth, no email
 * address anywhere in the return value, matching `GuardianConsentView`'s
 * own contract.
 */
export async function getGuardianConsent(
  consents: GuardianConsentRepository,
  profiles: UserProfileRepository,
  rawToken: string,
): Promise<Result<GuardianConsentView, GetGuardianConsentError>> {
  const row = await consents.findByTokenHash(hashOpaqueToken(rawToken));
  if (row === null) return err({ type: "not_found" });

  const profile = await profiles.findByUserId(row.userId);
  // Should not happen: this row is only ever created alongside a profile,
  // in the same transaction (AuthService.register) — treated as "no such
  // link" rather than a 500, the same defensive shape `AuthService.deliver`
  // already uses for the same kind of "should not happen" pairing.
  if (profile === null) return err({ type: "not_found" });

  return ok({
    status: guardianConsentStatusOf(row),
    displayName: profile.displayName,
    region: row.region,
    locale: profile.displayLocale,
  });
}

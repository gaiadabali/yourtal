import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { ApproveGuardianConsentResult } from "@yourtal/contracts/identity/guardian";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { GuardianConsentRepository } from "../persistence/guardian-consent.repository";
import type { UserProfileRepository } from "../persistence/user-profile.repository";
import type { ApproveGuardianConsentError } from "../guardian-consent.errors";

/**
 * `POST /api/guardian/:token/approve` (12.1.a). The guardian's `confirmAdult:
 * true` in the request body is validated at the DTO layer (a literal, not a
 * domain rule) — by the time this runs, the confirmation already happened.
 *
 * One transaction across this module's two tables (`identity
 * .guardian_consent` and `identity.user_profile`), the same reason
 * `AuthService.register` opens one across `identity.credential` and
 * `identity.user_profile`: a crash between the two writes must not leave a
 * teen "granted" in one table and still "pending" in the other, since B's
 * Cerbos gate (12.1.b) reads the profile's `parent_consent_status`, not this
 * table.
 */
export async function approveGuardianConsent(
  db: AppDb,
  consents: GuardianConsentRepository,
  profiles: UserProfileRepository,
  rawToken: string,
  now: Date,
): Promise<Result<ApproveGuardianConsentResult, ApproveGuardianConsentError>> {
  const tokenHash = hashOpaqueToken(rawToken);

  return db.transaction(async (tx) => {
    const transition = await consents.approve(tokenHash, now, tx);

    if (transition.transitioned) {
      await profiles.setParentConsentStatus(transition.userId, "granted", tx);
      return ok({ approved: true as const });
    }

    if (transition.reason === "not_found") {
      return err({ type: "not_found" as const });
    }
    if (transition.reason === "already_revoked") {
      // 12.1.a: revoked is final; re-approval is out of scope.
      return err({ type: "already_revoked" as const });
    }
    // already_granted: idempotent — a second click of the same approve
    // link changes nothing and still reports success.
    return ok({ approved: true as const });
  });
}

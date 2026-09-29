import { ResultAsync } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  AgeBand,
  Grant,
  GrantActionRequest,
  GrantRewardRequest,
} from "@yourtal/contracts/ledger-internal/rewards";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { DrizzleUserProfileRepository } from "../../modules/identity/persistence/drizzle-user-profile.repository";
import type { AppDb } from "../persistence/drizzle-client";
import type { LedgerInternalClient } from "./ledger-internal-client";

/** Thrown (never surfaced past this file) when a grant's userId has no `identity.user_profile` row to derive an ageBand from. */
class NoProfileForAgeBandError extends Error {
  constructor(userId: string) {
    super(`no identity.user_profile row for user ${userId}; ageBand cannot be derived`);
  }
}

/** The user's real ageBand from their own profile DOB — refuses (12.1.c: fail closed) rather than defaults when no profile is found. */
function resolveAgeBand(
  profiles: DrizzleUserProfileRepository,
  userId: string,
): ResultAsync<AgeBand, LedgerError> {
  const promise = profiles.findByUserId(userId).then((profile) => {
    if (profile === null) throw new NoProfileForAgeBandError(userId);
    return ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date()));
  });
  return ResultAsync.fromPromise(promise, (cause) =>
    ledgerError("region_mismatch", cause instanceof Error ? cause.message : String(cause)),
  );
}

/**
 * Sets every grant's ageBand from the user's own DOB, so the ledger applies the
 * teen cap; a caller-supplied value is ignored, since a spoofed "adult" is the
 * attack. Only the two grant methods are overridden; the rest resolve to
 * `inner` through the prototype. No profile refuses rather than defaults.
 */
export function withAgeBandEnrichment(
  inner: LedgerInternalClient,
  db: AppDb,
): LedgerInternalClient {
  const profiles = new DrizzleUserProfileRepository(db);
  const wrapped: LedgerInternalClient = Object.create(inner) as LedgerInternalClient;

  Object.assign(wrapped, {
    grantReward: (request: GrantRewardRequest): ResultAsync<Grant, LedgerError> =>
      resolveAgeBand(profiles, request.userId).andThen((ageBand) =>
        inner.grantReward({ ...request, ageBand }),
      ),
    grantAction: (request: GrantActionRequest): ResultAsync<Grant, LedgerError> =>
      resolveAgeBand(profiles, request.userId).andThen((ageBand) =>
        inner.grantAction({ ...request, ageBand }),
      ),
  });

  return wrapped;
}

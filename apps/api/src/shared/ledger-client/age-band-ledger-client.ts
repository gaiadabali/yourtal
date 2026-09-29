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
 * 12.1.c: F12's teen earn cap needs the principal's REAL age band on every
 * `grantReward`/`grantAction` — and a caller-supplied one can never be
 * trusted, since a spoofed "adult" is exactly what a teen account reaching
 * for the larger cap would send. This is the ONE place that derives it, so
 * no grant call site (`watch.controller.ts`, `streak.service.ts`,
 * `staff-users.controller.ts`, `grant-partner-action.use-case.ts`) has to
 * know this field exists, let alone set it correctly — `createLedgerClient`
 * wraps every `LEDGER_INTERNAL_CLIENT` this way, so it happens once.
 *
 * The returned object's PROTOTYPE is `inner` — so every method neither
 * override below defines (quote, balance, escrow, the settings trio, ...)
 * resolves straight through the prototype chain to the inner client's own
 * implementation, unedited and un-retyped here. Only `grantReward` and
 * `grantAction` are the wrapper's OWN properties, shadowing the inner ones;
 * an inner method reading its own fields (e.g. `this.db`) still resolves
 * them correctly, since those fields live on `inner` itself, further up the
 * SAME prototype chain the wrapper's `this` walks.
 *
 * Fails closed (12.1.c): no `identity.user_profile` row for the grant's
 * `userId` refuses with `region_mismatch` — the closed enum's existing code
 * for "this account is not who/where a grant expects" — rather than
 * defaulting to adult. In practice this should be unreachable for a real
 * signed-in user: every caller that reaches a grant has already loaded that
 * same profile for itself (e.g. `watch.controller.ts`'s own
 * `this.profiles.findByUserId` a few lines earlier, and
 * `apps/api/src/shared/authz`'s own "no profile row, no principal" rule) —
 * this is a second, independent check, not the first one.
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

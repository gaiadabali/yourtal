import { BadGatewayException, ConflictException, NotFoundException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { GetMeError } from "./me.errors";
import type {
  ApproveGuardianConsentError,
  GetGuardianConsentError,
  RevokeGuardianConsentError,
} from "./guardian-consent.errors";

/**
 * The one adapter for this module's domain errors (docs/13b section 4).
 *
 * Takes `GetMeError` only, not `GetMeError | UpdateMeError`: the two are,
 * today, both exactly `ProfileNotFoundError` — a single case, not yet a
 * real discriminated union — and a union of two identical types is a lint
 * error (`no-duplicate-type-constituents`), not extra safety. `UpdateMeError`
 * is structurally identical, so `updateMe`'s `Result`'s error still widens
 * here without a cast. There is also no `default`/`never` exhaustiveness
 * guard the way every other module's mapper has one: with one member there
 * is nothing for a guard to catch. Add both back the moment a second error
 * case exists on either type.
 */
export function mapMeErrorToHttpException(error: GetMeError): HttpException {
  // Should not be reachable in practice: a session only ever exists for a
  // user_id `AuthService.register` already gave a profile row. Kept as a
  // real 404 rather than a 500 in case that invariant is ever broken by a
  // future migration or a manually-created session.
  return new NotFoundException({
    code: error.type,
    message: "no profile exists for this account",
  });
}

/**
 * The guardian consent routes' own adapter (12.1.a). Unlike
 * `mapMeErrorToHttpException` above, `not_found` here is a REAL, expected
 * outcome — an unknown or bad token, deliberately given the same generic
 * 404 whether the token was never issued, is a typo, or belongs to no row
 * at all, so a caller cannot use the response to enumerate which — the
 * same "no enumeration oracle" discipline `ConsumeRefusal`'s own header
 * documents for `identity.verification_token`.
 */
export function mapGuardianConsentErrorToHttpException(
  error: GetGuardianConsentError | ApproveGuardianConsentError | RevokeGuardianConsentError,
): HttpException {
  switch (error.type) {
    case "not_found":
      return new NotFoundException({ code: "not_found", message: "No such guardian link." });
    case "already_revoked":
      return new ConflictException({
        code: "already_revoked",
        message: "This link already withdrew approval; it cannot approve again.",
      });
    case "ledger_unavailable":
      return new BadGatewayException({ code: "ledger_unavailable", message: error.cause });
  }
}

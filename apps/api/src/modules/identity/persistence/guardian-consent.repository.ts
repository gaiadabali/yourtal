import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/** `identity.guardian_consent` (12.1.a). */

export interface NewGuardianConsent {
  readonly userId: string;
  /** sha256 hex digest of the CSPRNG token the guardian email's links carry — never the token itself. */
  readonly tokenHash: string;
  readonly guardianEmail: string;
  readonly region: Region;
}

export interface StoredGuardianConsent {
  readonly userId: string;
  readonly tokenHash: string;
  /** Null once apps/worker's daily purge job clears it (12.4.b #4: the account turned 18). Always non-null right after creation. */
  readonly guardianEmail: string | null;
  readonly region: Region;
  readonly guardianConfirmedAdultAt: Date | null;
  readonly approvedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export type GuardianConsentStatus = "pending" | "granted" | "revoked";

/**
 * No stored status column (see the migration's header) — derived here, once,
 * from the same two timestamps every caller already has, rather than each
 * caller re-deriving it slightly differently.
 */
export function guardianConsentStatusOf(
  row: Pick<StoredGuardianConsent, "approvedAt" | "revokedAt">,
): GuardianConsentStatus {
  if (row.revokedAt !== null) return "revoked";
  if (row.approvedAt !== null) return "granted";
  return "pending";
}

/**
 * What an atomic approve/revoke transition reports back. `already_granted`
 * is only ever returned by `approve` (a second click of the same approve
 * link); `revoke`'s own WHERE clause allows either `pending` or `granted`
 * as its starting state, so its only refusal reason is `already_revoked`.
 * Both `already_*` reasons are resolved with a read AFTER the conditional
 * UPDATE already failed — see `DrizzleGuardianConsentRepository`'s own
 * comment for why that is not a check-then-act race.
 */
export type ConsentTransition =
  | { readonly transitioned: true; readonly userId: string; readonly region: Region }
  | {
      readonly transitioned: false;
      readonly reason: "not_found" | "already_granted" | "already_revoked";
    };

export interface GuardianConsentRepository {
  /**
   * `tx` (2.5/F31's own pattern): an open transaction to run this insert on,
   * so `AuthService.register` can make this row land or fail together with
   * `identity.credential`/`identity.user_profile`'s own inserts.
   */
  create(input: NewGuardianConsent, tx?: AppDb): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredGuardianConsent | null>;
  findByUserId(userId: string): Promise<StoredGuardianConsent | null>;
  /**
   * Atomic single-statement transition, pending -> granted, guarded by
   * `approved_at IS NULL AND revoked_at IS NULL` in the WHERE clause — the
   * same reasoning `CounterDeviceRepository.pair`'s own header gives for its
   * conditional UPDATE, so two concurrent presentations of one link cannot
   * both succeed. Also sets `guardian_confirmed_adult_at` — approval and
   * that confirmation are recorded together, enforced by the migration's own
   * CHECK. Idempotent from the CALLER's point of view: `already_revoked` is
   * the only failure reason this returns for a genuinely known token — an
   * already-GRANTED row is treated as success by the use-case layer, not
   * refused here.
   */
  approve(tokenHash: string, now: Date, tx?: AppDb): Promise<ConsentTransition>;
  /**
   * Atomic single-statement transition, (pending or granted) -> revoked.
   * `already_revoked` when the row was already in that state — 12.1.a's own
   * "revoked is final for this link".
   */
  revoke(tokenHash: string, now: Date, tx?: AppDb): Promise<ConsentTransition>;
}

export const GUARDIAN_CONSENT_REPOSITORY = Symbol("GUARDIAN_CONSENT_REPOSITORY");

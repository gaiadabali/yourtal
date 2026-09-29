import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { RevokeGuardianConsentResult } from "@yourtal/contracts/identity/guardian";
import { toPoints } from "@yourtal/contracts/money";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { GuardianConsentRepository } from "../persistence/guardian-consent.repository";
import type { UserProfileRepository } from "../persistence/user-profile.repository";
import type { RevokeGuardianConsentError } from "../guardian-consent.errors";

/**
 * `POST /api/guardian/:token/revoke` (12.1.a): "revoking sets the teen back
 * to restricted and escrows its balance." Escrows available AND pending
 * points, exactly the shape `StaffUsersController.suspend` already uses for
 * the same reason — see that handler's own comment.
 *
 * Ledger call BEFORE the database transition, not after: the escrow's
 * `idempotencyKey` is DERIVED from the row (`guardian-consent-revoke:
 * <userId>`), not from a client-supplied header, so a retry after a crash
 * between the two steps calls the ledger again with the SAME key (answered
 * idempotently, never a double-escrow) and then retries the DB transition,
 * which still succeeds because nothing committed the first time. The
 * reverse order — DB first — would risk a row marked revoked whose balance
 * was never actually protected if the process died right after.
 *
 * Idempotent end to end: an already-revoked row (this link used a second
 * time) escrows nothing further and reports success with `escrowedPoints:
 * 0` — 12.1.a's own "revoked is final for this link".
 */
export async function revokeGuardianConsent(
  db: AppDb,
  consents: GuardianConsentRepository,
  profiles: UserProfileRepository,
  ledger: LedgerInternalClient,
  rawToken: string,
  now: Date,
): Promise<Result<RevokeGuardianConsentResult, RevokeGuardianConsentError>> {
  const tokenHash = hashOpaqueToken(rawToken);

  const row = await consents.findByTokenHash(tokenHash);
  if (row === null) return err({ type: "not_found" });

  if (row.revokedAt !== null) {
    return ok({ revoked: true, escrowedPoints: toPoints(0) });
  }

  const balanceResult = await ledger.balance(row.userId);
  if (balanceResult.isErr()) {
    return err({ type: "ledger_unavailable", cause: balanceResult.error.message });
  }
  const balance = balanceResult.value;
  const pendingTotal = balance.pending.reduce((sum, bucket) => sum + bucket.points, 0);
  const totalPoints = balance.availablePoints + pendingTotal;

  // The ledger's escrow requires points > 0 — same guard
  // `StaffUsersController.suspend` applies for the same reason: nothing to
  // protect in a zero balance.
  if (totalPoints > 0) {
    const escrowResult = await ledger.escrow({
      userId: row.userId,
      points: toPoints(totalPoints),
      reason: "guardian_consent_revoked",
      idempotencyKey: `guardian-consent-revoke:${row.userId}`,
    });
    if (escrowResult.isErr()) {
      return err({ type: "ledger_unavailable", cause: escrowResult.error.message });
    }
  }

  // A lost race here (a concurrent call already flipped this row) still
  // escrowed exactly once above — the ledger call is idempotent on the same
  // derived key regardless of which caller's DB write actually lands.
  await db.transaction(async (tx) => {
    const transition = await consents.revoke(tokenHash, now, tx);
    if (transition.transitioned) {
      await profiles.setParentConsentStatus(transition.userId, "revoked", tx);
    }
  });

  return ok({ revoked: true, escrowedPoints: toPoints(totalPoints) });
}

import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type pg from "pg";
import type { DeleteGuardianAccountResult } from "@yourtal/contracts/identity/guardian";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { postgresHandlers } from "@yourtal/db/dsar-handlers";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import type { GuardianConsentRepository } from "../persistence/guardian-consent.repository";
import type { DeleteGuardianAccountError } from "../guardian-consent.errors";

/**
 * `POST /api/guardian/:token/delete-account` (12.4.b #6): the guardian runs
 * the exact same deletion the teen's OWN `DELETE /api/me` does
 * (`account.controller.ts`) -- `executeDeletion` against the same
 * `postgresHandlers`, not a parallel implementation that could quietly
 * drift from it. `postgresHandlers`' own `identity` handler now also erases
 * `identity.guardian_consent` (12.4.b #4's own migration/dsar-handlers.ts
 * change), so this call is what makes the token dead afterwards: a second
 * `GET/POST /api/guardian/:token[/...]` on the same link finds no row and
 * 404s, the same `not_found` this function itself returns for an
 * unknown/already-deleted token.
 *
 * ## Why this does not call `ledger.escrow` the way revoke does
 *
 * `revokeGuardianConsent` escrows the teen's outstanding balance because
 * the ACCOUNT SURVIVES revocation — there is a balance left to protect
 * from further spend. Deletion is different: `AccountController
 * .deleteAccount`'s own DSAR deletion does not touch the ledger domain
 * either (`postgresHandlers` supplies no `ledger` handler; `dsar.ts`'s
 * `ledger` domain stays `anonymise`d only once a ledger-side handler ships,
 * which is a gap that predates this ticket and applies identically to
 * self-deletion). Guardian-triggered deletion is built to match self-
 * deletion's behaviour exactly, gap included, rather than inventing a
 * SEPARATE balance rule for this one path that self-deletion itself does
 * not have — see this ticket's own report for the follow-up this leaves.
 */
export async function deleteGuardianAccount(
  pool: pg.Pool,
  consents: GuardianConsentRepository,
  rawToken: string,
): Promise<Result<DeleteGuardianAccountResult, DeleteGuardianAccountError>> {
  const tokenHash = hashOpaqueToken(rawToken);

  const row = await consents.findByTokenHash(tokenHash);
  if (row === null) return err({ type: "not_found" });

  await executeDeletion(row.userId, postgresHandlers(pool));

  return ok({ deleted: true });
}

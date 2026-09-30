import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type pg from "pg";
import type { DeleteGuardianAccountResult } from "@yourtal/contracts/identity/guardian";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { deletionHandlers } from "../../../shared/dsar/deletion-handlers";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import type { GuardianConsentRepository } from "../persistence/guardian-consent.repository";
import type { DeleteGuardianAccountError } from "../guardian-consent.errors";

/**
 * `POST /api/guardian/:token/delete-account` (12.4.b #6): the guardian runs
 * the exact same deletion the teen's OWN `DELETE /api/me` does
 * (`account.controller.ts`) -- `executeDeletion` against the same
 * `deletionHandlers`, not a parallel implementation that could quietly
 * drift from it. The `identity` handler also erases
 * `identity.guardian_consent` (12.4.b #4's own migration/dsar-handlers.ts
 * change), so this call is what makes the token dead afterwards: a second
 * `GET/POST /api/guardian/:token[/...]` on the same link finds no row and
 * 404s, the same `not_found` this function itself returns for an
 * unknown/already-deleted token.
 *
 * The ledger's part is `deletionHandlers`' own (13.24): the balance is
 * escrowed for good and the grants' device and IP are cleared, the same as
 * self-deletion.
 */
export async function deleteGuardianAccount(
  pool: pg.Pool,
  consents: GuardianConsentRepository,
  ledger: LedgerInternalClient,
  rawToken: string,
): Promise<Result<DeleteGuardianAccountResult, DeleteGuardianAccountError>> {
  const tokenHash = hashOpaqueToken(rawToken);

  const row = await consents.findByTokenHash(tokenHash);
  if (row === null) return err({ type: "not_found" });

  await executeDeletion(row.userId, deletionHandlers(pool, ledger));

  return ok({ deleted: true });
}

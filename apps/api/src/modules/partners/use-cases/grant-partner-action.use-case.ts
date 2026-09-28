import { createHash } from "node:crypto";
import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PartnerActionResult } from "@yourtal/contracts/device/partner-action";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { LinkCodeLookup } from "../persistence/link-code-lookup";
import type { PartnerReceiptRepository } from "../persistence/partner-receipt.repository";
import type { PartnerActionError } from "../partners.errors";
import { wrapPersistence } from "../wrap-persistence";

export interface GrantPartnerActionInput {
  readonly partnerId: string;
  readonly linkCode: string;
  readonly externalRef: string;
}

/** A region setting reader, narrowed to the one call this use-case needs (`ledger.getSettings`'s own shape, threaded through so this file stays test-fakeable without a real ledger client). */
export type ReceiptPointsReader = (region: "AU" | "ID") => Promise<number>;

/** F12: trust tier 3 for a partner-sourced action — staff-set only, never shown to the user, same as any demo/partner-originated grant. */
const PARTNER_TRUST_TIER = 3 as const;

/**
 * TASKS.md 8.4.a. `externalRef` is the receipt's own hash (unique per
 * (partner, hash), enforced by `receipts.recordIfNew`) — the ledger's own
 * `idempotencyKey` is DERIVED from it rather than reused raw, so a retried
 * call with the identical body replays the same grant rather than risking
 * a second one if the receipt-uniqueness insert and the ledger call ever
 * raced.
 */
export function grantPartnerAction(
  ledger: LedgerInternalClient,
  linkCodes: LinkCodeLookup,
  receipts: PartnerReceiptRepository,
  receiptPoints: ReceiptPointsReader,
  input: GrantPartnerActionInput,
): ResultAsync<PartnerActionResult, PartnerActionError | LedgerError> {
  return wrapPersistence(linkCodes.resolve(input.linkCode)).andThen((resolved) => {
    if (resolved === null) {
      return errAsync<PartnerActionResult, PartnerActionError | LedgerError>({
        type: "invalid_link_code",
      });
    }

    return wrapPersistence(
      receipts.recordIfNew({
        partnerId: input.partnerId,
        receiptHash: input.externalRef,
        userId: resolved.userId,
        externalRef: input.externalRef,
      }),
    ).andThen((isNew) => {
      if (!isNew) {
        return errAsync<PartnerActionResult, PartnerActionError | LedgerError>({
          type: "duplicate_receipt",
        });
      }

      return wrapPersistence(receiptPoints(resolved.region)).andThen((points) => {
        const idempotencyKey = createHash("sha256")
          .update(`partner_receipt:${input.partnerId}:${input.externalRef}`)
          .digest("hex");

        return ledger
          .grantAction({
            kind: "receipt",
            userId: resolved.userId,
            region: resolved.region,
            points: toPoints(points),
            trustTier: PARTNER_TRUST_TIER,
            idempotencyKey,
          })
          .map((grant) => ({ granted: true as const, points: grant.points }));
      });
    });
  });
}

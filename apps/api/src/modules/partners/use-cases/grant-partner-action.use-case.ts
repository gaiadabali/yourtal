import { createHash } from "node:crypto";
import { okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PartnerActionResult } from "@yourtal/contracts/device/partner-action";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { PartnerReceiptRepository } from "../persistence/partner-receipt.repository";
import type { PartnerLink } from "../persistence/partner-link.repository";
import type { PartnersError } from "../to-http-exception";
import { wrapPersistence } from "../wrap-persistence";
import { linkPartnerAccount, resolveActiveLink } from "./partner-link.use-case";
import type { PartnerLinkDeps } from "./partner-link.use-case";

export interface GrantPartnerActionInput {
  readonly partnerId: string;
  /** Exactly one of these two (the request schema refuses anything else). */
  readonly linkCode?: string | undefined;
  readonly linkId?: string | undefined;
  readonly externalRef: string;
}

/** A region setting reader, narrowed to the one call this use-case needs (`ledger.getSettings`'s own shape, threaded through so this file stays test-fakeable without a real ledger client). */
export type ReceiptPointsReader = (region: "AU" | "ID") => Promise<number>;

export interface GrantPartnerActionDeps extends PartnerLinkDeps {
  readonly ledger: LedgerInternalClient;
  readonly receipts: PartnerReceiptRepository;
  readonly receiptPoints: ReceiptPointsReader;
}

/** F12: trust tier 3 for a partner-sourced action — staff-set only, never shown to the user, same as any demo/partner-originated grant. */
const PARTNER_TRUST_TIER = 3 as const;

/**
 * TASKS.md 8.4.a, 14.3.b. `externalRef` is the receipt's own hash, unique
 * per (partner, hash) in `platform.partner_receipt`. The ledger's
 * `idempotencyKey` is DERIVED from it, so the ledger pays a receipt at most
 * once whatever happens here.
 *
 * A receipt already recorded is a success, not an error (14.3.b): for the
 * same account the grant is asked for again under the same key, which
 * replays the original payout, or completes it if the first call recorded
 * the receipt and then failed at the ledger. A receipt first reported for a
 * different account pays nothing.
 */
export function grantPartnerAction(
  deps: GrantPartnerActionDeps,
  input: GrantPartnerActionInput,
): ResultAsync<PartnerActionResult, PartnersError> {
  const link =
    input.linkId === undefined
      ? linkPartnerAccount(deps, { partnerId: input.partnerId, code: input.linkCode ?? "" })
      : resolveActiveLink(deps, { partnerId: input.partnerId, linkId: input.linkId });

  return link.andThen((resolved) =>
    grantForLink(deps, resolved, input).mapErr((error): PartnersError => ({
      ...error,
      linkId: resolved.id,
    })),
  );
}

function grantForLink(
  deps: GrantPartnerActionDeps,
  link: PartnerLink,
  input: GrantPartnerActionInput,
): ResultAsync<PartnerActionResult, PartnersError> {
  return wrapPersistence(
    deps.receipts.claim({
      partnerId: input.partnerId,
      receiptHash: input.externalRef,
      userId: link.userId,
      externalRef: input.externalRef,
    }),
  ).andThen((claim): ResultAsync<PartnerActionResult, PartnersError> => {
    const duplicate = !claim.isNew;
    if (claim.userId !== link.userId) {
      return okAsync({ granted: false, points: 0, linkId: link.id, duplicate: true });
    }

    return wrapPersistence(deps.receiptPoints(link.region)).andThen((points) => {
      const idempotencyKey = createHash("sha256")
        .update(`partner_receipt:${input.partnerId}:${input.externalRef}`)
        .digest("hex");

      return deps.ledger
        .grantAction({
          kind: "receipt",
          userId: link.userId,
          region: link.region,
          points: toPoints(points),
          trustTier: PARTNER_TRUST_TIER,
          idempotencyKey,
        })
        .map((grant): PartnerActionResult => ({
          granted: true,
          points: grant.points,
          linkId: link.id,
          duplicate,
        }))
        .mapErr((error: LedgerError): PartnersError => error);
    });
  });
}

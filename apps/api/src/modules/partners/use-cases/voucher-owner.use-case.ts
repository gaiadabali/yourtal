import type { ResultAsync } from "neverthrow";
import type { PartnerVoucherOwnerResult } from "@yourtal/contracts/device/partner-action";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type { PartnersError } from "../to-http-exception";
import { resolveActiveLink } from "./partner-link.use-case";
import type { PartnerLinkDeps } from "./partner-link.use-case";

export interface VoucherOwnerDeps extends Pick<PartnerLinkDeps, "links" | "ages"> {
  readonly vouchers: Pick<VoucherInternalClient, "holding">;
}

export interface VoucherOwnerInput {
  readonly partnerId: string;
  readonly linkId: string;
  readonly codeSha256: string;
}

/**
 * 2.8 T4 (docs/28 4.2): is this code in the linked user's wallet, for this
 * partner? The link is resolved as for a receipt (only the partner's own,
 * active link; links are adult-only when made and a date of birth never
 * changes). Fails closed: held only when the listing is bound to THIS partner
 * and the voucher's region is the link's. Every other case, including another
 * person's or an unknown code, is the identical `{ linkId, held: false }`, so
 * the partner learns nothing about codes outside its user's wallet. The
 * voucher's region and bound partner are never forwarded.
 */
export function voucherOwner(
  deps: VoucherOwnerDeps,
  input: VoucherOwnerInput,
): ResultAsync<PartnerVoucherOwnerResult, PartnersError> {
  return resolveActiveLink(deps, input).andThen((link) =>
    deps.vouchers
      .holding({ codeSha256: input.codeSha256, ownerId: link.userId })
      .mapErr((error): PartnersError => ({
        type: "persistence_failed",
        cause: `voucher holding read refused: ${error.code}`,
      }))
      .map((holding): PartnerVoucherOwnerResult => {
        if (
          !holding.held ||
          holding.redeemPartnerId !== input.partnerId ||
          holding.region !== link.region
        ) {
          return { linkId: link.id, held: false };
        }
        return {
          linkId: link.id,
          held: true,
          status: holding.status,
          faceValueMinor: holding.faceValueMinor,
          currency: holding.currency,
          expiresAt: holding.expiresAt,
        };
      }),
  );
}

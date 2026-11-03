import type { ResultAsync } from "neverthrow";
import type { VoucherPreview } from "@yourtal/contracts/voucher-internal/redemption";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { ResultAsync as RA } from "neverthrow";
import type { BusinessAccountRepository } from "../../../business/persistence/business-account.repository";
import type {
  VoucherError,
  VoucherInternalClient,
} from "../../../../shared/voucher-client/voucher-internal-client";

function toView(preview: VoucherPreview, merchantName: string): CounterVoucherPreview {
  return {
    voucherId: preview.voucherId,
    merchantName,
    offerTitle: preview.offerTitle,
    remainingValueMinor: preview.remainingValueMinor,
    currency: preview.currency,
    partialRedemptionPolicy:
      preview.partialRedemptionPolicy === "balance_carrying" ? "balance_carrying" : "single_use",
  };
}

/**
 * 8.2.a: a read-only preview, no hold placed — see voucher-internal/redemption.ts's own comment.
 * The shop name is the business's own display name, not the listing's free-text one
 * (which the voucher service copied); the listing's stays as the fallback if the business is gone.
 */
export function lookupVoucher(
  vouchers: VoucherInternalClient,
  businesses: BusinessAccountRepository,
  businessId: string,
  code: string,
): ResultAsync<CounterVoucherPreview, VoucherError> {
  return vouchers
    .lookupAsDevice({ voucherCode: code, merchantId: businessId })
    .andThen((preview) =>
      RA.fromSafePromise(businesses.findById(businessId).catch(() => null)).map((business) =>
        toView(preview, business?.displayName ?? preview.merchantName),
      ),
    );
}

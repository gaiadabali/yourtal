import type { ResultAsync } from "neverthrow";
import type { VoucherPreview } from "@yourtal/contracts/voucher-internal/redemption";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import type { VoucherError, VoucherInternalClient } from "../../../../shared/voucher-client/voucher-internal-client";

function toView(preview: VoucherPreview): CounterVoucherPreview {
  return {
    voucherId: preview.voucherId,
    merchantName: preview.merchantName,
    offerTitle: preview.offerTitle,
    remainingValueMinor: preview.remainingValueMinor,
    currency: preview.currency,
    partialRedemptionPolicy:
      preview.partialRedemptionPolicy === "balance_carrying" ? "balance_carrying" : "single_use",
  };
}

/** 8.2.a: a read-only preview, no hold placed — see voucher-internal/redemption.ts's own comment. */
export function lookupVoucher(
  vouchers: VoucherInternalClient,
  businessId: string,
  code: string,
): ResultAsync<CounterVoucherPreview, VoucherError> {
  return vouchers
    .lookupAsDevice({ voucherCode: code, merchantId: businessId })
    .map(toView);
}

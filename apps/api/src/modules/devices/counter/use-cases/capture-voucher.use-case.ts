import type { ResultAsync } from "neverthrow";
import type { CounterCapture } from "@yourtal/contracts/device/counter-redemption";
import type { VoucherError, VoucherInternalClient } from "../../../../shared/voucher-client/voucher-internal-client";
import type { AuthorizationMetaRepository } from "../../persistence/authorization-meta.repository";
import type { CaptureLogRepository } from "../../persistence/capture-log.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

export type CaptureVoucherError = VoucherError | PersistenceFailedError;

/**
 * 8.2.b/8.2.g: captures the hold, then writes the BFF's own audit row —
 * services/voucher is still the only source of truth for the money moving;
 * this is the receipt, not a second ledger. `locationId` is the DEVICE's
 * own (from its principal, never the request), so a missing authorize-meta
 * row (a restart between the two calls, say) still logs a usable receipt —
 * only the order ref/total are thinner than they should be, never the
 * capture itself, which already happened whether this write succeeds or not.
 */
export function captureVoucher(
  vouchers: VoucherInternalClient,
  authorizationMeta: AuthorizationMetaRepository,
  captureLog: CaptureLogRepository,
  deviceId: string,
  businessId: string,
  locationId: string,
  authorizationId: string,
): ResultAsync<CounterCapture, CaptureVoucherError> {
  return vouchers
    .captureAsDevice({ authorizationId, deviceId, merchantId: businessId })
    .andThen((capture) =>
      wrapPersistence(authorizationMeta.takeByAuthorizationId(authorizationId)).andThen((meta) => {
        const orderRef = meta?.orderRef ?? "unknown";
        return wrapPersistence(
          captureLog.record({
            captureId: capture.captureId,
            deviceId,
            businessId,
            locationId: meta?.locationId ?? locationId,
            voucherId: capture.voucherId,
            amountMinor: capture.amountMinor,
            currency: capture.currency,
            orderRef,
            orderTotalMinor: meta?.orderTotalMinor ?? capture.amountMinor,
            authorizedAt: new Date(),
            capturedAt: new Date(capture.capturedAt),
          }),
        ).map(() => ({ ...capture, orderRef }));
      }),
    );
}

import type { ResultAsync } from "neverthrow";
import type { CounterAuthorizeRequest, CounterAuthorization } from "@yourtal/contracts/device/counter-redemption";
import type { VoucherError, VoucherInternalClient } from "../../../../shared/voucher-client/voucher-internal-client";
import type { AuthorizationMetaRepository } from "../../persistence/authorization-meta.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

export interface AuthorizeVoucherInput extends CounterAuthorizeRequest {
  readonly deviceId: string;
  readonly businessId: string;
  readonly locationId: string;
}

export type AuthorizeVoucherError = VoucherError | PersistenceFailedError;

/**
 * 8.2.b: places a 5-minute hold, then saves the BFF-only order ref/total
 * (services/voucher's device path carries neither) so `captureVoucher` can
 * write a complete audit row without a second round trip.
 */
export function authorizeVoucher(
  vouchers: VoucherInternalClient,
  authorizationMeta: AuthorizationMetaRepository,
  input: AuthorizeVoucherInput,
): ResultAsync<CounterAuthorization, AuthorizeVoucherError> {
  return vouchers
    .authorizeAsDevice({
      voucherCode: input.code,
      deviceId: input.deviceId,
      merchantId: input.businessId,
      amountMinor: input.amountMinor,
      currency: input.currency,
    })
    .andThen((authorization) =>
      wrapPersistence(
        authorizationMeta.save({
          authorizationId: authorization.authorizationId,
          deviceId: input.deviceId,
          businessId: input.businessId,
          locationId: input.locationId,
          orderRef: input.orderRef,
          orderTotalMinor: input.orderTotalMinor,
        }),
      ).map(() => authorization),
    );
}

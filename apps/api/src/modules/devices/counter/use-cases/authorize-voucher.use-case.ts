import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { MinorUnits } from "@yourtal/contracts/money";
import type {
  CounterAuthorizeRequest,
  CounterAuthorization,
} from "@yourtal/contracts/device/counter-redemption";
import type { VoucherPreview } from "@yourtal/contracts/voucher-internal/redemption";
import type {
  VoucherError,
  VoucherInternalClient,
} from "../../../../shared/voucher-client/voucher-internal-client";
import type { AuthorizationMetaRepository } from "../../persistence/authorization-meta.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

export interface AuthorizeVoucherInput extends CounterAuthorizeRequest {
  readonly deviceId: string;
  readonly businessId: string;
  readonly locationId: string;
}

/** The amount a cashier asked to take is not one this voucher can give: refused before any hold is placed. */
export interface AmountRefusedError {
  readonly type: "amount_refused";
  readonly code: "amount_not_positive" | "amount_exceeds_remaining_value";
  readonly remainingValueMinor: number;
}

export type AuthorizeVoucherError = VoucherError | PersistenceFailedError | AmountRefusedError;

/**
 * The server's own say on the amount, whatever the screen already checked:
 * more than nothing and no more than what is left. services/voucher refuses the
 * same amounts; checking here first lets the counter say which rule it was and
 * quote the remaining value. A part of a single-use voucher stays allowed, as
 * the service allows it (the rest is forfeited); the counter only ever sends
 * the whole value for one.
 */
export function refuseAmount(
  preview: VoucherPreview,
  requested: number | undefined,
): AmountRefusedError | null {
  const remaining = preview.remainingValueMinor;
  const amount = requested ?? remaining;
  const refuse = (code: AmountRefusedError["code"]): AmountRefusedError => ({
    type: "amount_refused",
    code,
    remainingValueMinor: remaining,
  });
  if (amount <= 0) return refuse("amount_not_positive");
  if (amount > remaining) return refuse("amount_exceeds_remaining_value");
  return null;
}

/**
 * 8.2.b: previews the voucher, refuses an amount it cannot give, places a
 * 5-minute hold, then saves the BFF-only order ref/total and the voucher's
 * title (services/voucher's device path carries none of them) so
 * `captureVoucher` can write a complete audit row, and the cashier's log can
 * name the voucher, without a second round trip.
 */
export function authorizeVoucher(
  vouchers: VoucherInternalClient,
  authorizationMeta: AuthorizationMetaRepository,
  input: AuthorizeVoucherInput,
): ResultAsync<CounterAuthorization, AuthorizeVoucherError> {
  return vouchers
    .lookupAsDevice({ voucherCode: input.code, merchantId: input.businessId })
    .andThen((preview): ResultAsync<CounterAuthorization, AuthorizeVoucherError> => {
      const refusal = refuseAmount(preview, input.amountMinor);
      if (refusal !== null) return errAsync(refusal);
      const amountMinor: MinorUnits =
        input.amountMinor ?? toMinorUnits(preview.remainingValueMinor);
      return vouchers
        .authorizeAsDevice({
          voucherCode: input.code,
          deviceId: input.deviceId,
          merchantId: input.businessId,
          amountMinor,
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
              offerTitle: preview.offerTitle,
            }),
          ).map(() => authorization),
        );
    });
}

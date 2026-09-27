import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import type { PurchaseResult } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import type { PurchasePointsError } from "../billing.errors";
import { wrapLedgerCall, wrapPersistence } from "../wrap-billing";

export interface PurchasePointsCommand {
  readonly merchantId: string;
  readonly points: number;
  /** Stated by the caller, never defaulted (7.5.a: "no IDR default"). Must equal the business's own currency. */
  readonly currency: string;
  /** The route's `Idempotency-Key` header, scoped to this business so two businesses never collide on it. */
  readonly idempotencyKey: string;
}

/**
 * 7.5.a: quote -> simulated charge -> ledger purchase, in that order. The
 * charge happens BEFORE `purchasePoints` so a declined card never reaches
 * the ledger at all; `purchasePoints` is itself idempotent on
 * `idempotencyKey` (`ledger-client.purchasePoints`), so a retry after a
 * network failure between the charge and the ledger call replays the SAME
 * allocation rather than granting twice.
 *
 * The simulated driver's `charge()` returns `status: "pending"` rather than
 * settling synchronously (it models a real async payment webhook) -- there
 * is no webhook consumer built for Studio billing yet (nothing in this
 * codebase has one), so this treats an ACCEPTED charge as good enough to
 * fund the allocation now, matching every other "simulated means demo
 * money" boundary this platform runs. A real settlement-confirmation flow is
 * a Phase 10+ concern, not named in 7.5's own spec.
 */
export function purchasePoints(
  ledger: Pick<LedgerInternalClient, "quotePurchase" | "purchasePoints">,
  payments: PaymentsDriver,
  businessRegionLookup: BusinessRegionLookup,
  command: PurchasePointsCommand,
): ResultAsync<PurchaseResult, PurchasePointsError> {
  return wrapPersistence(businessRegionLookup.findRegionAndCurrency(command.merchantId)).andThen(
    (business) => {
      if (business === null) {
        return errAsync<PurchaseResult, PurchasePointsError>({
          type: "business_not_found",
          businessId: command.merchantId,
        });
      }
      if (business.currency !== command.currency) {
        return errAsync<PurchaseResult, PurchasePointsError>({
          type: "currency_mismatch",
          expected: business.currency,
          stated: command.currency,
        });
      }

      const points = toPoints(command.points);
      return wrapLedgerCall(ledger.quotePurchase({ points, region: business.region })).andThen(
        (quote) =>
          ResultAsync.fromSafePromise(
            payments.charge({
              idempotencyKey: command.idempotencyKey,
              amountMinor: quote.totalMinor,
              currency: quote.currency,
              reference: `studio-billing:${command.merchantId}:${command.idempotencyKey}`,
            }),
          ).andThen((charge) => {
            if (charge.isErr()) {
              return errAsync<PurchaseResult, PurchasePointsError>({
                type: "payment_declined",
                detail: charge.error.detail,
              });
            }
            return wrapLedgerCall(
              ledger.purchasePoints({
                businessId: command.merchantId,
                region: business.region,
                currency: business.currency,
                points,
                paidMinor: quote.totalMinor,
                idempotencyKey: command.idempotencyKey,
              }),
            ).andThen((allocation) =>
              okAsync<PurchaseResult, PurchasePointsError>({
                allocation,
                paidMinor: quote.totalMinor,
                currency: quote.currency,
                providerReference: charge.value.providerReference,
              }),
            );
          }),
      );
    },
  );
}

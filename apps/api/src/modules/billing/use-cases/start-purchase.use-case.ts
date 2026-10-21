import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { BillingAllocation, PurchaseResult } from "@yourtal/contracts/billing";
import { withTax } from "@yourtal/contracts/money/tax";
import type { BoundaryFailure } from "@yourtal/drivers/fault-engine";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import type { PaymentAccountsService } from "../../payments/payment-accounts.service";
import { checkoutLocale } from "../../payments/payment-accounts.service";
import { gstRateBpsFor } from "../../payments/tax-rate";
import type { PurchasePointsError } from "../billing.errors";
import type {
  CardPurchaseRepository,
  CardPurchaseRow,
} from "../persistence/card-purchase.repository";
import { toCardPurchase } from "../persistence/card-purchase.repository";
import { fulfilPurchase } from "./fulfil-purchase.use-case";

export const PURCHASE_PREFIX = "card-purchase";
/** Stripe needs at least 30 minutes; the extra minute absorbs the time between our clock and theirs. */
const CHECKOUT_LIFETIME_MS = 31 * 60 * 1000;

export interface StartPurchaseDeps {
  readonly ledger: Pick<LedgerInternalClient, "quotePackage" | "purchasePoints" | "getAllocation">;
  readonly businesses: BusinessRegionLookup;
  readonly settings: RegionSettingsReader;
  readonly purchases: Pick<
    CardPurchaseRepository,
    "insertOnce" | "find" | "attachCheckout" | "markPaid" | "markNeedsReview"
  >;
  readonly accounts: Pick<PaymentAccountsService, "ensureCustomer" | "driverFor">;
  readonly webOrigin: string;
  readonly now: () => Date;
}

export interface StartPurchaseCommand {
  readonly merchantId: string;
  /** 14.13 (F121): the package bought; its points and price come from the ledger. */
  readonly tierKey: string;
  /** Stated by the caller, never defaulted (7.5.a). Must equal the business's own currency. */
  readonly currency: string;
  /** The route's `Idempotency-Key`, scoped to this business. Also the ledger's key for the grant. */
  readonly idempotencyKey: string;
}

/**
 * 5.1.a / 14.13: the package's quote (ex-GST, plus GST) -> a pending purchase row -> the
 * processor's checkout. Points are granted only when the payment is
 * confirmed: by the verified webhook for Stripe, or at once when the
 * simulated driver answers `paid`. Every call is keyed on the row, so a
 * retry reaches the same checkout instead of opening a second one.
 */
export async function startPurchase(
  deps: StartPurchaseDeps,
  command: StartPurchaseCommand,
): Promise<Result<PurchaseResult, PurchasePointsError>> {
  const business = await deps.businesses.findRegionAndCurrency(command.merchantId);
  if (business === null) return err({ type: "business_not_found", businessId: command.merchantId });
  if (business.currency !== command.currency) {
    return err({
      type: "currency_mismatch",
      expected: business.currency,
      stated: command.currency,
    });
  }
  const owner = { kind: "business" as const, id: command.merchantId, region: business.region };
  const driver = deps.accounts.driverFor(owner);

  const quote = await deps.ledger.quotePackage({
    region: business.region,
    tierKey: command.tierKey,
  });
  if (quote.isErr()) return err({ type: "ledger_refused", ...quote.error });
  const taxRateBps = await gstRateBpsFor(deps.settings, business.region);
  const split = withTax(quote.value.totalMinor, taxRateBps);

  const row = await deps.purchases.insertOnce({
    businessId: command.merchantId,
    region: business.region,
    currency: business.currency,
    tierKey: command.tierKey,
    points: quote.value.points,
    ...split,
    taxRateBps,
    idempotencyKey: command.idempotencyKey,
    provider: driver.provider,
    checkoutExpiresAt: new Date(deps.now().getTime() + CHECKOUT_LIFETIME_MS),
  });
  if (row.businessId !== command.merchantId || row.tierKey !== command.tierKey) {
    return err({ type: "purchase_conflict" });
  }
  if (row.status !== "pending" || row.checkoutExpiresAt <= deps.now()) {
    return ok(await answer(deps, row, null, null));
  }

  const customer = await deps.accounts.ensureCustomer(owner);
  if (customer.isErr()) return err(paymentError(customer.error));
  const back = `${deps.webOrigin}/studio/billing?business=${encodeURIComponent(row.businessId)}&purchase=${row.id}`;
  // Built from the row alone, so a retry sends the processor exactly the same request.
  const started = await driver.startCheckout({
    idempotencyKey: `${PURCHASE_PREFIX}:${row.id}`,
    amountMinor: row.totalMinor,
    currency: row.currency,
    reference: `${PURCHASE_PREFIX}:${row.id}`,
    description: describePoints(row),
    customerRef: customer.value,
    successUrl: back,
    cancelUrl: `${back}&cancelled=1`,
    locale: checkoutLocale(row.region),
    expiresAt: row.checkoutExpiresAt,
  });
  if (started.isErr()) return err(paymentError(started.error));
  if (started.value.kind === "redirect") {
    await deps.purchases.attachCheckout(row.id, started.value.checkoutReference);
    return ok(await answer(deps, row, started.value.url, null));
  }
  // The simulated driver settles at once: it took exactly what it was asked for.
  const fulfilled = await fulfilPurchase(deps, row, {
    amountMinor: row.totalMinor,
    currency: row.currency,
    paymentRef: started.value.paymentReference,
  });
  return ok(await answer(deps, fulfilled.row, null, fulfilled.allocation));
}

function describePoints(row: CardPurchaseRow): string {
  return row.region === "ID"
    ? `${new Intl.NumberFormat("id-ID").format(row.points)} poin YourTal`
    : `${new Intl.NumberFormat("en-AU").format(row.points)} YourTal points`;
}

function paymentError(failure: BoundaryFailure): PurchasePointsError {
  return failure.kind === "declined"
    ? { type: "payment_declined", detail: failure.detail }
    : { type: "payment_unavailable", detail: failure.detail };
}

async function answer(
  deps: Pick<StartPurchaseDeps, "ledger" | "now">,
  row: CardPurchaseRow,
  checkoutUrl: string | null,
  granted: BillingAllocation | null,
): Promise<PurchaseResult> {
  const now = deps.now();
  let allocation = granted;
  if (allocation === null && row.status === "paid" && row.allocationId !== null) {
    const found = await deps.ledger.getAllocation(row.allocationId);
    allocation = found.isOk() ? found.value : null;
  }
  // A pending row whose page has closed is expired in all but the webhook that says so.
  const lapsed = row.status === "pending" && (checkoutUrl === null || row.checkoutExpiresAt <= now);
  const status = lapsed ? "expired" : row.status === "pending" ? "awaiting_payment" : row.status;
  return {
    status,
    purchaseId: row.id,
    checkoutUrl: status === "awaiting_payment" ? checkoutUrl : null,
    purchase: toCardPurchase(row),
    allocation:
      allocation === null
        ? null
        : {
            allocationId: allocation.allocationId,
            region: allocation.region,
            funderType: allocation.funderType,
            totalPoints: allocation.totalPoints,
            remainingPoints: allocation.remainingPoints,
            programme: null,
            createdAt: allocation.createdAt,
          },
  };
}

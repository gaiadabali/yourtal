import { randomUUID } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { reachesAudience } from "@yourtal/contracts/audience/audience";
import type { CheckoutQuote } from "@yourtal/contracts/checkout/checkout";
import { ledgerError, type LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { REGION_CONFIG, type Region } from "@yourtal/contracts/region";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { ListingForCheckout } from "../persistence/listing-for-checkout";
import type { SagaDeps } from "./run-saga";

/** Online vouchers are the most fungible, so they wait for an established account (docs/16). */
const ONLINE_MIN_TRUST_TIER = 2;

export interface Buyer {
  readonly userId: string;
  readonly region: Region;
  readonly dateOfBirth: string;
  readonly trustTier: number;
}

export type QuoteRefusal =
  LedgerError | { readonly code: "listing_unavailable"; readonly message: string };

/**
 * 4.7.a/b: checks who may buy what, then asks the ledger to price and lock
 * the listing for 15 minutes, and opens the saga that confirming will run.
 */
export async function quoteCheckout(
  deps: SagaDeps,
  buyer: Buyer,
  listing: ListingForCheckout | null,
): Promise<Result<CheckoutQuote, QuoteRefusal>> {
  if (listing === null || !listing.buyable) {
    return err({ code: "listing_unavailable", message: "this reward is not available" });
  }
  // AU and ID never cross: the listing, the buyer and the cash are one region.
  if (
    listing.region !== buyer.region ||
    listing.currency !== REGION_CONFIG[buyer.region].currency
  ) {
    return err(ledgerError("region_mismatch", "this reward is not offered in your region"));
  }
  const ageBand = ageBandFrom(ageYearsFrom(buyer.dateOfBirth, deps.now()));
  if (!reachesAudience(listing.audience, { ageBand })) {
    return err(ledgerError("audience_blocked", "this reward is not available for your account"));
  }
  if (listing.channel === "online" && buyer.trustTier < ONLINE_MIN_TRUST_TIER) {
    return err(
      ledgerError("audience_blocked", "online rewards unlock as your account builds history"),
    );
  }

  const quoted = await deps.ledger.quote({
    region: listing.region,
    currency: REGION_CONFIG[listing.region].currency,
    settlementMinor: listing.settlementMinor,
  });
  if (quoted.isErr()) return err(quoted.error);
  const locked = await deps.ledger.lockQuote({ quoteId: quoted.value.quoteId });
  if (locked.isErr()) return err(locked.error);

  const saga = await deps.sagas.create({
    id: randomUUID(),
    userId: buyer.userId,
    listingId: listing.id,
    region: listing.region,
    currency: REGION_CONFIG[listing.region].currency,
    quoteId: locked.value.quoteId,
    pricePoints: locked.value.pricePoints,
    settlementMinor: listing.settlementMinor,
    quoteExpiresAt: new Date(locked.value.expiresAt),
  });
  return ok({
    checkoutId: saga.id,
    listingId: listing.id,
    pricePoints: locked.value.pricePoints,
    expiresAt: locked.value.expiresAt,
  });
}

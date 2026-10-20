import type { MarketplacePaymentsDriver } from "@yourtal/drivers/marketplace-payments";
import type { PaymentAccountsService } from "../../payments/payment-accounts.service";
import type { GiftParty } from "../../wallet/gift-party-reader";
import { refusal } from "./auction-errors";

/** A Stripe connected account's id starts with this; the charity's onboarding stores it. */
const CONNECTED_ACCOUNT_PREFIX = "acct_";

/**
 * A charity can take auction money once the processor has an account for it:
 * on Stripe that is a connected account (`acct_…`, set when its onboarding
 * finishes). The simulated driver settles into any reference.
 */
export function charityReady(driver: MarketplacePaymentsDriver, payoutReference: string): boolean {
  return driver.provider !== "stripe" || payoutReference.startsWith(CONNECTED_ACCOUNT_PREFIX);
}

/** What a bid's hold carries beyond the amount: the bidder's card and the charity's account. */
export interface HoldTarget {
  readonly customerRef?: string;
  readonly paymentMethodRef?: string;
  readonly destinationReference?: string;
}

/**
 * Refuses a bid the processor could not charge (`charity_not_ready`, then
 * `card_required`) and otherwise names what the hold needs. A driver that
 * charges no saved card (Indonesia, simulated) needs nothing: the hold is
 * as it always was.
 */
export async function holdTargetFor(
  deps: { accounts: Pick<PaymentAccountsService, "liveCard"> },
  driver: MarketplacePaymentsDriver,
  bidder: GiftParty,
  payoutReference: string,
): Promise<HoldTarget> {
  if (!charityReady(driver, payoutReference)) {
    throw refusal(
      "charity_not_ready",
      "This charity has not finished setting up to take payments.",
    );
  }
  if (!driver.needsSavedCard) return {};
  const card = await deps.accounts.liveCard({
    kind: "user",
    id: bidder.userId,
    region: bidder.region,
  });
  if (card === null) throw refusal("card_required", "Add a card to bid.");
  return {
    customerRef: card.customerRef,
    paymentMethodRef: card.paymentMethodRef,
    destinationReference: payoutReference,
  };
}

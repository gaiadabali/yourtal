import "server-only";

import { checkoutQuoteSchema, type CheckoutQuote } from "@yourtal/contracts/checkout/checkout";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * 11.6.b: locks a listing's real points price for 15 minutes
 * (`services/ledger/internal/pricing/quotes.go`) and opens the checkout
 * saga that `confirm-checkout-action.ts` will run. `@NotValueMoving`
 * server-side (`checkout.controller.ts`) — quoting spends nothing, so it is
 * safe to call on every render of `/store/[listingId]/redeem`, including a
 * "Muat ulang harga" re-quote (`router.refresh()`).
 *
 * Every refusal here (`region_mismatch`, `audience_blocked`,
 * `listing_unavailable`, or any other 1.2.c code) is a fact about the
 * listing or the account, decided BEFORE any points move — `redeem/page.tsx`
 * renders it as a failure panel instead of `BurnFlow`, since there is no
 * checkout to review yet.
 */
export function quoteCheckout(listingId: string): Promise<ApiResult<CheckoutQuote>> {
  return apiFetch("/api/checkout/quote", checkoutQuoteSchema, {
    method: "POST",
    body: { listingId },
  });
}

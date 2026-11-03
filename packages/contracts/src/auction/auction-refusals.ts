// 13.4.d: zod-free, so client components can import these without pulling zod.
/** How long a listed voucher is up for auction (see `auction.ts` for the lifecycle). */
export const AUCTION_DURATION_HOURS = 72;
export const AUCTION_REFUSALS = [
  "charity_unavailable",
  "voucher_not_unused",
  // Newly bought: the holding period (fraud-check lag) has not ended yet.
  "voucher_holdback",
  "voucher_not_transferable",
  "voucher_already_transferred",
  "seller_ineligible",
  "bidder_ineligible",
  "own_auction",
  "auction_closed",
  "bid_too_low",
  "payment_declined",
  // A saved card is needed to bid (AU on Stripe); the charity has not finished onboarding with the processor.
  "card_required",
  "charity_not_ready",
] as const;

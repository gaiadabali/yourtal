// 13.4.d: zod-free, so client components can import these without pulling zod.
export const AUCTION_REFUSALS = [
  "charity_unavailable",
  "voucher_not_unused",
  "voucher_not_transferable",
  "voucher_already_transferred",
  "seller_ineligible",
  "bidder_ineligible",
  "own_auction",
  "auction_closed",
  "bid_too_low",
  "payment_declined",
] as const;

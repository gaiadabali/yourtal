// 13.4.d: zod-free, so client components can import these without pulling zod.
export const WALLET_GIFT_REFUSALS = [
  "gift_recipient_ineligible",
  "gift_sender_ineligible",
  "gift_to_self",
  "gift_not_transferable",
  "gift_already_gifted",
  "gift_not_unused",
  "gift_holdback",
  "gift_velocity_capped",
  "gift_not_pending",
  "gift_window_closed",
] as const;

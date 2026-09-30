import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/**
 * 13.20.b (F86): a viewer gives an unused voucher to another verified adult
 * in their region, by email. The old code stops working at once; the
 * recipient accepts within 7 days or it goes back. No message, no profile:
 * the recipient sees only the sender's display name.
 *
 * `POST /api/wallet/vouchers/:voucherId/gift` → `WalletGift`
 * `GET /api/wallet/gifts` → `WalletGiftList`
 * `POST /api/wallet/gifts/:giftId/accept` and `/decline` → `WalletGift`
 */
export const giftVoucherBodySchema = z.object({
  recipientEmail: z.email().max(320),
});
export type GiftVoucherBody = z.infer<typeof giftVoucherBodySchema>;

export const walletGiftStatusSchema = z.enum(["pending", "accepted", "returned"]);
export type WalletGiftStatus = z.infer<typeof walletGiftStatusSchema>;

export const walletGiftDirectionSchema = z.enum(["sent", "received"]);
export type WalletGiftDirection = z.infer<typeof walletGiftDirectionSchema>;

export const walletGiftSchema = z.object({
  giftId: z.uuid(),
  direction: walletGiftDirectionSchema,
  status: walletGiftStatusSchema,
  /** Received gifts only. A sent gift names nobody. */
  senderDisplayName: z.string().nullable(),
  /**
   * The voucher to open: a received gift's new voucher (in the wallet once
   * accepted); a sent gift's original, or the returned one once it is back.
   */
  voucherId: z.uuid(),
  title: z.string(),
  merchantName: z.string(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  voucherExpiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  /** Accept by this time, or the gift goes back to the sender. */
  acceptBy: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type WalletGift = z.infer<typeof walletGiftSchema>;

export const walletGiftListSchema = z.object({ gifts: z.array(walletGiftSchema) });
export type WalletGiftList = z.infer<typeof walletGiftListSchema>;

/**
 * A refused gift answers 409 `{ code, message }` with one of these.
 * `gift_recipient_ineligible` covers every recipient problem (no account,
 * not verified, under 18, another region) so an email reveals nothing.
 * `gift_sender_ineligible`: the caller's own email is unverified or the
 * account is suspended.
 */
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
export const walletGiftRefusalSchema = z.enum(WALLET_GIFT_REFUSALS);
export type WalletGiftRefusal = z.infer<typeof walletGiftRefusalSchema>;

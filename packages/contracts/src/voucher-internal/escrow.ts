import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 13.22.a/c: the voucher service's auction escrow (`/internal/v1/escrow*`).
 * `hold` voids the seller's voucher and remints it into escrow at once;
 * `release` hands the escrowed voucher to the winner, the charity, or back
 * to the seller. Refusals reuse the gift codes (`voucher-internal/gifts.ts`).
 */
export const voucherEscrowHoldRequestSchema = z.object({
  auctionId: z.uuid(),
  voucherId: z.uuid(),
  sellerId: z.uuid(),
  region: regionSchema,
});
export type VoucherEscrowHoldRequest = z.infer<typeof voucherEscrowHoldRequestSchema>;

export const voucherEscrowSchema = z.object({
  auctionId: z.uuid(),
  sourceVoucherId: z.uuid(),
  voucherId: z.uuid(),
  sellerId: z.uuid(),
  region: regionSchema,
  state: z.enum(["held", "released"]),
  releasedTo: z.uuid().nullable(),
  listingId: z.uuid(),
  title: z.string(),
  merchantName: z.string(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  voucherExpiresAt: z.iso.datetime(),
});
export type VoucherEscrow = z.infer<typeof voucherEscrowSchema>;

export const voucherEscrowReleaseRequestSchema = z.object({
  auctionId: z.uuid(),
  ownerId: z.uuid(),
});
export type VoucherEscrowReleaseRequest = z.infer<typeof voucherEscrowReleaseRequestSchema>;

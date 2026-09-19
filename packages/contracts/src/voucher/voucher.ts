import { z } from "zod";
import { idrMinorUnitsSchema } from "../money/money";
import { partialRedemptionPolicySchema } from "../listing/listing";

/**
 * A voucher is a bearer instrument minted when a user redeems points against
 * a listing (docs/09 section 7). It is deliberately a separate schema from
 * `Listing`: a listing is catalogue inventory, a voucher is one user's
 * held claim against it, with its own code, remaining value and lifecycle.
 */
export const voucherStatusSchema = z.enum(["active", "redeemed", "expired", "transferred"]);
export type VoucherStatus = z.infer<typeof voucherStatusSchema>;

const MAX_MERCHANT_NAME_LENGTH = 120;

export const voucherSchema = z
  .object({
    id: z.uuid(),
    listingId: z.uuid(),
    ownerId: z.uuid(),
    code: z.string().min(6).max(24),
    merchantName: z.string().min(1).max(MAX_MERCHANT_NAME_LENGTH),
    title: z.string().min(1).max(140),
    faceValueIdr: idrMinorUnitsSchema,
    remainingValueIdr: idrMinorUnitsSchema,
    partialRedemptionPolicy: partialRedemptionPolicySchema,
    transferable: z.boolean(),
    status: voucherStatusSchema,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((voucher) => voucher.remainingValueIdr <= voucher.faceValueIdr, {
    message: "remainingValueIdr cannot exceed faceValueIdr",
    path: ["remainingValueIdr"],
  })
  .refine((voucher) => new Date(voucher.expiresAt).getTime() > new Date(voucher.issuedAt).getTime(), {
    message: "expiresAt must be after issuedAt",
    path: ["expiresAt"],
  });

export type Voucher = z.infer<typeof voucherSchema>;

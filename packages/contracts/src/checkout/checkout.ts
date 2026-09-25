import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * The viewer's checkout (TASKS.md 4.7): a quote holds a listing's points
 * price for 15 minutes; confirming it spends the points and issues the
 * voucher exactly once. Points only; the server prices everything.
 */
export const checkoutQuoteRequestSchema = z.object({ listingId: z.uuid() });
export type CheckoutQuoteRequest = z.infer<typeof checkoutQuoteRequestSchema>;

export const checkoutQuoteSchema = z.object({
  checkoutId: z.uuid(),
  listingId: z.uuid(),
  pricePoints: pointsSchema,
  expiresAt: z.iso.datetime(),
});
export type CheckoutQuote = z.infer<typeof checkoutQuoteSchema>;

export const checkoutRequestSchema = z.object({ checkoutId: z.uuid() });
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** `pending` means the points are spent and the voucher is still being issued. */
export const checkoutResultSchema = z.object({
  checkoutId: z.uuid(),
  state: z.enum(["done", "pending"]),
  voucherId: z.uuid(),
  pricePoints: pointsSchema,
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

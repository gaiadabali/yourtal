import { z } from "zod";
import { reservationSchema } from "./lifecycle";

/**
 * TASKS.md 1.2.b's wallet reads.
 *
 * Returns `Reservation` (id, listing, saga, state), not the full public
 * `voucherSchema` (merchant name, face value, redemption policy...): this
 * internal service tracks the voucher's LIFECYCLE, and the denormalized
 * display fields the wallet actually renders live on the listing it was
 * issued against. The real `services/voucher` does carry its own
 * denormalized copy of those fields (`voucher.vouchers`), so
 * `HttpVoucherClient` (4.5) may need to widen this shape when it wraps that
 * service for real — a contract change for that task, not a limitation this
 * one works around silently.
 */
export const listForUserRequestSchema = z.object({
  userId: z.uuid(),
  limit: z.number().int().positive().max(100).default(20),
  startingAfter: z.uuid().optional(),
});
export type ListForUserRequest = z.infer<typeof listForUserRequestSchema>;

export const listForUserResultSchema = z.object({
  vouchers: z.array(reservationSchema),
  hasMore: z.boolean(),
});
export type ListForUserResult = z.infer<typeof listForUserResultSchema>;

export const getVoucherRequestSchema = z.object({
  voucherId: z.uuid(),
  ownerId: z.uuid(),
});
export type GetVoucherRequest = z.infer<typeof getVoucherRequestSchema>;

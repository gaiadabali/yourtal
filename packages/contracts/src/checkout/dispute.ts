import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * 4.7.c, K13: the viewer reports a voucher the merchant would not honour.
 * A closed list of reasons: no free text reaches staff from a viewer.
 */
export const disputeReasonSchema = z.enum(["not_honoured", "merchant_closed", "other"]);
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

export const disputeRequestSchema = z.object({ reason: disputeReasonSchema });
export type DisputeRequest = z.infer<typeof disputeRequestSchema>;

/** reinstated: the points are back in the wallet now. queued: staff will look at it. */
export const disputeResultSchema = z.object({
  voucherId: z.uuid(),
  outcome: z.enum(["reinstated", "queued"]),
  points: pointsSchema,
});
export type DisputeResult = z.infer<typeof disputeResultSchema>;

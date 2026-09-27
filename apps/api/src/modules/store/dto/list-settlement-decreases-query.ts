import { z } from "zod";

/** Only `pending` exists as a filter today -- there is no "rejected" state yet (YT-0575's own scope). */
export const listSettlementDecreasesQuerySchema = z.object({
  state: z.literal("pending"),
});

export type ListSettlementDecreasesQuery = z.infer<typeof listSettlementDecreasesQuerySchema>;

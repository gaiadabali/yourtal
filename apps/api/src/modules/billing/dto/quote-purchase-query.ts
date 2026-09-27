import { z } from "zod";

export const quotePurchaseQuerySchema = z.object({
  points: z.coerce.number().int().positive(),
});

export type QuotePurchaseQuery = z.infer<typeof quotePurchaseQuerySchema>;

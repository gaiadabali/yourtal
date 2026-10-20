import * as z from "zod";
import { regionSchema } from "@yourtal/contracts/region";

/** Staff's list: any region, any business. Query-string values arrive as text. */
export const invoiceListQuerySchema = z.object({
  region: regionSchema.optional(),
  businessId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

import { z } from "zod";
import { regionSchema } from "@yourtal/contracts/region";

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  region: regionSchema.optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

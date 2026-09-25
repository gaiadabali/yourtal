import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { displayLocaleSchema } from "@yourtal/contracts/identity/user-profile";

/** `PATCH /api/me` (1.4.d) — display name and locale only; never `region`, which is immutable. */
export const updateMeSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  displayLocale: displayLocaleSchema.optional(),
});

export type UpdateMeRequest = z.infer<typeof updateMeSchema>;

export class UpdateMeDto extends createZodDto(updateMeSchema) {}

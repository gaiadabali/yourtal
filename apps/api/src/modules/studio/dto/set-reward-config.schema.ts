import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { pointsSchema } from "@yourtal/contracts/money";

/** TASKS.md 7.3.c. `funderType`/`maxPointsForCampaign` beyond the allocation link are validated server-side (listAllocations, F14 ceiling) -- never trusted from the request. */
export const setRewardConfigSchema = z.object({
  allocationId: z.string().min(1),
  rewardPointsPerCompletion: pointsSchema,
  accuracyBonusPoints: pointsSchema,
  maxPointsForCampaign: pointsSchema,
});

export type SetRewardConfigRequest = z.infer<typeof setRewardConfigSchema>;

export class SetRewardConfigDto extends createZodDto(setRewardConfigSchema) {}

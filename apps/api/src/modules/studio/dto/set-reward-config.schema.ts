import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { pointsSchema } from "@yourtal/contracts/money";

/** TASKS.md 7.3.c. `funderType`/`maxPointsForCampaign` beyond the allocation link are validated server-side (listAllocations, F14 ceiling) -- never trusted from the request. */
export const setRewardConfigSchema = z.object({
  allocationId: z.string().min(1),
  rewardPointsPerCompletion: pointsSchema,
  accuracyBonusPoints: pointsSchema,
  /** 14.2: the campaign's total budget, in points. */
  maxPointsForCampaign: pointsSchema,
  /** 14.2: the most it pays out in one day on its region's clock; null (the default) is none. */
  dailyCapPoints: pointsSchema.nullable().default(null),
});

export type SetRewardConfigRequest = z.infer<typeof setRewardConfigSchema>;

export class SetRewardConfigDto extends createZodDto(setRewardConfigSchema) {}

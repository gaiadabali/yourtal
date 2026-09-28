import { createZodDto } from "nestjs-zod";
import {
  decideProposalBodySchema,
  proposeManualPurchaseBodySchema,
  proposeMarketingFundingBodySchema,
  proposeRateBodySchema,
  proposeSettingBodySchema,
} from "@yourtal/contracts/staff/economy";
import { setKillSwitchRequestSchema } from "@yourtal/contracts/voucher-internal/kill-switch";
import { z } from "zod";

/** TASKS.md 9.5: request bodies for the staff economy console's mutating routes. */

export class ProposeRateDto extends createZodDto(proposeRateBodySchema) {}
export class ProposeMarketingFundingDto extends createZodDto(proposeMarketingFundingBodySchema) {}
export class ProposeManualPurchaseDto extends createZodDto(proposeManualPurchaseBodySchema) {}
export class ProposeSettingDto extends createZodDto(proposeSettingBodySchema) {}
export class DecideProposalDto extends createZodDto(decideProposalBodySchema) {}

/** `scope`/`targetId`/`reason`/`active` from the client; `setBy` always comes from the principal. */
export const tripKillSwitchBodySchema = setKillSwitchRequestSchema.omit({ setBy: true });
export class TripKillSwitchDto extends createZodDto(tripKillSwitchBodySchema) {}

export const regionParamSchema = z.object({ region: z.enum(["AU", "ID"]) });

import { createZodDto } from "nestjs-zod";
import {
  decideSettlementProposalBodySchema,
  proposePayoutBodySchema,
  resolveStatementDisputeBodySchema,
} from "@yourtal/contracts/staff/settlement";
import { z } from "zod";

/** TASKS.md 10.6.a: request bodies for the staff settlement console's mutating routes. */

export class ResolveStatementDisputeDto extends createZodDto(resolveStatementDisputeBodySchema) {}
export class ProposePayoutDto extends createZodDto(proposePayoutBodySchema) {}
export class DecideSettlementProposalDto extends createZodDto(
  decideSettlementProposalBodySchema,
) {}

export const regionParamSchema = z.object({ region: z.enum(["AU", "ID"]) });

import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { minorUnitsSchema } from "@yourtal/contracts/money";

/**
 * Proposes a material settlement-value decrease (YT-0575). Records a
 * pending request; applies nothing. `reason` is required for the same
 * reason `setSettlementValueSchema`'s is: a two-person-approval action
 * needs an audit row somebody can later read and understand.
 */
export const proposeSettlementDecreaseSchema = z.object({
  proposedSettlementValueMinor: minorUnitsSchema,
  reason: z.string().min(1).max(500),
});

export type ProposeSettlementDecreaseRequest = z.infer<typeof proposeSettlementDecreaseSchema>;

export class ProposeSettlementDecreaseDto extends createZodDto(proposeSettlementDecreaseSchema) {}

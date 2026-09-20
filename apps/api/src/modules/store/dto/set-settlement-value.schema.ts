import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { idrMinorUnitsSchema } from "@yourtal/contracts/money";

/**
 * Reprices a listing (docs/17 section 2.1). `reason` is required, not
 * optional — a two-person-approval action needs an audit row somebody can
 * later read and understand, not a bare number change.
 */
export const setSettlementValueSchema = z.object({
  newSettlementValueIdr: idrMinorUnitsSchema,
  reason: z.string().min(1).max(500),
});

export type SetSettlementValueRequest = z.infer<typeof setSettlementValueSchema>;

export class SetSettlementValueDto extends createZodDto(setSettlementValueSchema) {}

import { createZodDto } from "nestjs-zod";
import { proposeDisbursementRetryBodySchema } from "@yourtal/contracts/staff/settlement";

/** 5.2.c: the reason a payout retry is proposed is required, like every staff money action's. */
export class ProposeDisbursementRetryDto extends createZodDto(proposeDisbursementRetryBodySchema) {}

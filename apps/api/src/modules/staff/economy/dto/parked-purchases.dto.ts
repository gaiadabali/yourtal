import { createZodDto } from "nestjs-zod";
import { proposeRefundBodySchema } from "@yourtal/contracts/staff/parked-purchases";

/** 5.1.g: the reason a refund is proposed is required, like every staff money action's. */
export class ProposeRefundDto extends createZodDto(proposeRefundBodySchema) {}

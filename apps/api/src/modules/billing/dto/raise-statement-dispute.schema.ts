import { createZodDto } from "nestjs-zod";
import { raiseStatementDisputeRequestSchema } from "@yourtal/contracts/billing";

/** 10.6.b: `statementId` comes from the route param, never the body. */
export class RaiseStatementDisputeDto extends createZodDto(raiseStatementDisputeRequestSchema) {}

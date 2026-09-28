import { createZodDto } from "nestjs-zod";
import { partnerActionRequestSchema } from "@yourtal/contracts/device/partner-action";

export class PartnerActionDto extends createZodDto(partnerActionRequestSchema) {}

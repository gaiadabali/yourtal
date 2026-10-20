import { createZodDto } from "nestjs-zod";
import {
  partnerActionRequestSchema,
  partnerLinkRequestSchema,
} from "@yourtal/contracts/device/partner-action";

export class PartnerActionDto extends createZodDto(partnerActionRequestSchema) {}

export class PartnerLinkDto extends createZodDto(partnerLinkRequestSchema) {}

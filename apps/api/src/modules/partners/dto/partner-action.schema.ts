import { createZodDto } from "nestjs-zod";
import {
  partnerActionRequestSchema,
  partnerLinkRequestSchema,
  partnerReceiptStatusRequestSchema,
} from "@yourtal/contracts/device/partner-action";

export class PartnerActionDto extends createZodDto(partnerActionRequestSchema) {}

export class PartnerLinkDto extends createZodDto(partnerLinkRequestSchema) {}

export class PartnerReceiptStatusDto extends createZodDto(partnerReceiptStatusRequestSchema) {}

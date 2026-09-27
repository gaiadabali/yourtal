import { createZodDto } from "nestjs-zod";
import {
  counterAuthorizeRequestSchema,
  counterCaptureRequestSchema,
  counterLookupRequestSchema,
} from "@yourtal/contracts/device/counter-redemption";

export class CounterLookupDto extends createZodDto(counterLookupRequestSchema) {}
export class CounterAuthorizeDto extends createZodDto(counterAuthorizeRequestSchema) {}
export class CounterCaptureDto extends createZodDto(counterCaptureRequestSchema) {}

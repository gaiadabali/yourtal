import { createZodDto } from "nestjs-zod";
import { pairDeviceRequestSchema } from "@yourtal/contracts/device/counter-device";

export class PairDeviceDto extends createZodDto(pairDeviceRequestSchema) {}

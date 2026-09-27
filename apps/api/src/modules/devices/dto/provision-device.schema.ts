import { createZodDto } from "nestjs-zod";
import { provisionDeviceRequestSchema } from "@yourtal/contracts/device/counter-device";

export class ProvisionDeviceDto extends createZodDto(provisionDeviceRequestSchema) {}

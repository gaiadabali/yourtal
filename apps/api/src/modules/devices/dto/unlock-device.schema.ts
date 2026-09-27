import { createZodDto } from "nestjs-zod";
import { unlockDeviceRequestSchema } from "@yourtal/contracts/device/counter-device";

export class UnlockDeviceDto extends createZodDto(unlockDeviceRequestSchema) {}

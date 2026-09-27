import { createZodDto } from "nestjs-zod";
import { initiateMediaUploadRequestSchema } from "@yourtal/contracts/studio/media";

export class InitiateMediaUploadDto extends createZodDto(initiateMediaUploadRequestSchema) {}

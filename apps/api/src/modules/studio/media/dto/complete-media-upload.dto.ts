import { createZodDto } from "nestjs-zod";
import { completeMediaUploadRequestSchema } from "@yourtal/contracts/studio/media";

export class CompleteMediaUploadDto extends createZodDto(completeMediaUploadRequestSchema) {}

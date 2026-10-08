import { createListingImageUploadUrlRequestSchema } from "@yourtal/contracts/listing/image";
import { createZodDto } from "nestjs-zod";

export class CreateListingImageUploadUrlDto extends createZodDto(
  createListingImageUploadUrlRequestSchema,
) {}

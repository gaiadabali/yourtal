import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** The KYB document types this module accepts as an upload — scans and photos, never a script or archive. */
export const kybUploadContentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png"]);

export const createKybUploadUrlSchema = z.object({
  contentType: kybUploadContentTypeSchema,
});

export type CreateKybUploadUrlRequest = z.infer<typeof createKybUploadUrlSchema>;

export class CreateKybUploadUrlDto extends createZodDto(createKybUploadUrlSchema) {}

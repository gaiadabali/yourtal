import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { kybDocumentTypeSchema } from "@yourtal/contracts/business/kyb-document";

export const submitKybDocumentSchema = z.object({
  documentType: kybDocumentTypeSchema,
  storageRef: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

export type SubmitKybDocumentRequest = z.infer<typeof submitKybDocumentSchema>;

export class SubmitKybDocumentDto extends createZodDto(submitKybDocumentSchema) {}

import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationSchema>;

export class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}

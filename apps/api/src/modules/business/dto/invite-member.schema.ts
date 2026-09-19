import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { grantableRoleSchema } from "./grantable-role.schema";

export const inviteMemberSchema = z.object({
  userId: z.string().min(1),
  role: grantableRoleSchema,
});

export type InviteMemberRequest = z.infer<typeof inviteMemberSchema>;

export class InviteMemberDto extends createZodDto(inviteMemberSchema) {}

import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { grantableRoleSchema } from "./grantable-role.schema";

/**
 * TASKS.md 7.1.c: an email, not a `userId` the caller would have to already
 * know (docs/audit/2026-09-25/business-merchant.md flagged the old
 * `userId`-only invite). `.pipe(z.email())` matches every other email field
 * in this codebase (register/login/billing-contact schemas).
 */
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  role: grantableRoleSchema,
});

export type InviteMemberRequest = z.infer<typeof inviteMemberSchema>;

export class InviteMemberDto extends createZodDto(inviteMemberSchema) {}

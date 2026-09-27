import { z } from "zod";
import { regionSchema } from "../region/region";

/** The six internal roles (`@yourtal/authz` INTERNAL_ROLES; apps/api's staff tests pin the two together). */
export const staffRoleSchema = z.enum([
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
  "admin",
]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** `GET /api/staff/me` (TASKS.md 9.1): who is using the staff console, and as which roles. */
export const staffSessionSchema = z
  .object({
    userId: z.string().min(1),
    email: z.string().nullable(),
    roles: z.array(staffRoleSchema).min(1),
    region: regionSchema,
  })
  .strict();
export type StaffSession = z.infer<typeof staffSessionSchema>;

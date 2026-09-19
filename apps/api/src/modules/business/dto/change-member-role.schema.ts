import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { grantableRoleSchema } from "./grantable-role.schema";

export const changeMemberRoleSchema = z.object({ role: grantableRoleSchema });

export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleSchema>;

export class ChangeMemberRoleDto extends createZodDto(changeMemberRoleSchema) {}

import { eq } from "drizzle-orm";
import { principalRoleSchema } from "@yourtal/authz/roles";
import type { PrincipalRole } from "@yourtal/authz/roles";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { staffRoles } from "./schema/staff-role.table";
import type { StaffRoleReader } from "./staff-role-reader";

export class DrizzleStaffRoleReader implements StaffRoleReader {
  constructor(private readonly db: AppDb) {}

  async listForUser(userId: string): Promise<readonly PrincipalRole[]> {
    const rows = await this.db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(eq(staffRoles.userId, userId));
    // Parsed, not cast: the DB's CHECK constraint and this schema are two
    // independent statements of the same six roles, the same
    // belt-and-braces boundary-parse discipline every row assembler here
    // follows (see `packages/authz/src/roles.ts` for the source of truth).
    return rows.map((row) => principalRoleSchema.parse(row.role));
  }
}

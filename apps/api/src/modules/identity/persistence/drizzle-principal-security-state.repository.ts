import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { principalSecurityState } from "./schema/principal-security-state.table";
import type {
  PrincipalSecurityState,
  PrincipalSecurityStateRepository,
} from "./principal-security-state.repository";

export class DrizzlePrincipalSecurityStateRepository implements PrincipalSecurityStateRepository {
  constructor(private readonly db: AppDb) {}

  async findByUserId(userId: string): Promise<PrincipalSecurityState | null> {
    const [row] = await this.db
      .select({ valueFrozenUntil: principalSecurityState.valueFrozenUntil })
      .from(principalSecurityState)
      .where(eq(principalSecurityState.userId, userId));
    if (row === undefined) return null;
    return { valueFrozenUntil: row.valueFrozenUntil };
  }
}

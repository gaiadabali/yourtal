import { eq } from "drizzle-orm";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { userProfiles } from "../../identity/persistence/schema/user-profile.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/**
 * F101/F105: only adults link a partner app. The code endpoint already
 * refuses a teen; the partner side checks again, so a link never depends on
 * one gate. Reads `identity.user_profile` the way `drizzle-link-code-lookup.ts`
 * reads `me.link_code`.
 */
export interface AccountAgeLookup {
  /** `null` when the account has no profile (deleted). */
  ageBandOf(userId: string): Promise<"teen" | "adult" | null>;
}

export const ACCOUNT_AGE_LOOKUP = Symbol("ACCOUNT_AGE_LOOKUP");

export class DrizzleAccountAgeLookup implements AccountAgeLookup {
  constructor(private readonly db: AppDb) {}

  async ageBandOf(userId: string): Promise<"teen" | "adult" | null> {
    const [row] = await this.db
      .select({ dateOfBirth: userProfiles.dateOfBirth })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (row === undefined) return null;
    return ageBandFrom(ageYearsFrom(row.dateOfBirth, new Date()));
  }
}

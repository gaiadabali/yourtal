import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { credentials } from "../../auth/persistence/schema/credential.table";

/** 13.18.b: the caller's own sign-in email, for the header's account menu. */
export interface AccountEmailReader {
  /** The password credential's normalised email, or `null` if the account has none. */
  emailFor(userId: string): Promise<string | null>;
}

export const ACCOUNT_EMAIL_READER = Symbol("ACCOUNT_EMAIL_READER");

export class DrizzleAccountEmailReader implements AccountEmailReader {
  constructor(private readonly db: AppDb) {}

  async emailFor(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ identifier: credentials.identifier })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, "password")))
      .limit(1);
    return row?.identifier ?? null;
  }
}

import { and, eq, isNotNull } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { credentials } from "../auth/persistence/schema/credential.table";
import { userProfiles } from "../identity/persistence/schema/user-profile.table";
import { normalizeEmail } from "../auth/email";

/** One side of a gift: a verified account with a profile. */
export interface GiftParty {
  readonly userId: string;
  readonly region: Region;
  readonly dateOfBirth: string;
  readonly suspended: boolean;
  readonly displayName: string;
  readonly displayLocale: "en-AU" | "id-ID";
  /** The verified sign-in email, for receipts. */
  readonly email: string;
}

/**
 * 13.20.b: who may send or receive a gift. Only an account whose sign-in
 * email is verified counts (docs/09 §7 rule 2: no open links, verified
 * users only). Age and region are the caller's to judge from what this reads.
 */
export class GiftPartyReader {
  constructor(private readonly db: AppDb) {}

  byEmail(email: string): Promise<GiftParty | null> {
    return this.find(eq(credentials.identifier, normalizeEmail(email)));
  }

  byUserId(userId: string): Promise<GiftParty | null> {
    return this.find(eq(credentials.userId, userId));
  }

  private async find(match: ReturnType<typeof eq>): Promise<GiftParty | null> {
    const [row] = await this.db
      .select({
        userId: userProfiles.userId,
        region: userProfiles.region,
        dateOfBirth: userProfiles.dateOfBirth,
        suspendedAt: userProfiles.suspendedAt,
        displayName: userProfiles.displayName,
        displayLocale: userProfiles.displayLocale,
        email: credentials.identifier,
      })
      .from(credentials)
      .innerJoin(userProfiles, eq(userProfiles.userId, credentials.userId))
      .where(and(match, eq(credentials.kind, "password"), isNotNull(credentials.verifiedAt)))
      .limit(1);
    if (row === undefined) return null;
    return {
      userId: row.userId,
      region: row.region as Region,
      dateOfBirth: row.dateOfBirth,
      suspended: row.suspendedAt !== null,
      displayName: row.displayName,
      displayLocale: row.displayLocale === "id-ID" ? "id-ID" : "en-AU",
      email: row.email,
    };
  }
}

export const GIFT_PARTY_READER = Symbol("GIFT_PARTY_READER");

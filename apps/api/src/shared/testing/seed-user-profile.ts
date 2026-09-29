import { DrizzleUserProfileRepository } from "../../modules/identity/persistence/drizzle-user-profile.repository";
import type { AppDb } from "../persistence/drizzle-client";
import type { Region } from "@yourtal/contracts/region";

/**
 * 1.5.a: a minimal real `identity.user_profile` row, for tests that need
 * `AsyncPrincipalResolver`'s 1.5.b overlay to engage at all — it only reads
 * `jurisdiction`/`ageBand`/`isSuspended`/`businessRoles` from the database
 * when a profile row exists for the principal's id. A comfortably-adult
 * date of birth by default, matching `session-for.ts`'s own default.
 */
export async function seedUserProfile(
  db: AppDb,
  args: {
    readonly userId: string;
    readonly region?: Region;
    /** ISO date. Default is comfortably adult; 12.1.b's own tests pass a teen's. */
    readonly dateOfBirth?: string;
    /** Default `"not_required"` (an adult). 12.1.b's own tests pass a teen's grant state. */
    readonly parentConsentStatus?: "not_required" | "pending" | "granted";
  },
): Promise<void> {
  const region = args.region ?? "AU";
  await new DrizzleUserProfileRepository(db).create({
    userId: args.userId,
    region,
    displayLocale: region === "AU" ? "en-AU" : "id-ID",
    displayName: "1.5.a Test User",
    dateOfBirth: args.dateOfBirth ?? "1990-01-01",
    timezone: "Australia/Sydney",
    guardianEmail: null,
    parentConsentStatus: args.parentConsentStatus ?? "not_required",
  });
}

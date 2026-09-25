import { eq } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { userProfiles } from "./schema/user-profile.table";
import type {
  NewUserProfile,
  ParentConsentStatus,
  StoredUserProfile,
  UserProfileRepository,
  UserProfileUpdate,
} from "./user-profile.repository";

export class DrizzleUserProfileRepository implements UserProfileRepository {
  constructor(private readonly db: AppDb) {}

  async create(profile: NewUserProfile): Promise<void> {
    await this.db.insert(userProfiles).values({
      userId: profile.userId,
      region: profile.region,
      displayLocale: profile.displayLocale,
      displayName: profile.displayName,
      dateOfBirth: profile.dateOfBirth,
      timezone: profile.timezone,
      guardianEmail: profile.guardianEmail,
      parentConsentStatus: profile.parentConsentStatus,
    });
  }

  async findByUserId(userId: string): Promise<StoredUserProfile | null> {
    const [row] = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    if (row === undefined) return null;
    return {
      userId: row.userId,
      region: readRegion(row.region),
      displayLocale: readDisplayLocale(row.displayLocale),
      displayName: row.displayName,
      dateOfBirth: row.dateOfBirth,
      timezone: row.timezone,
      guardianEmail: row.guardianEmail,
      parentConsentStatus: readParentConsentStatus(row.parentConsentStatus),
      trustTier: row.trustTier,
      suspendedAt: row.suspendedAt,
    };
  }

  async update(userId: string, patch: UserProfileUpdate): Promise<void> {
    if (patch.displayName === undefined && patch.displayLocale === undefined) return;
    await this.db
      .update(userProfiles)
      .set({
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        ...(patch.displayLocale === undefined ? {} : { displayLocale: patch.displayLocale }),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  }
}

// The columns below are CHECK-constrained by the migration to exactly these
// values, so trusting the round trip rather than re-validating with a schema
// matches how every other hand-rolled `pg`/Drizzle mapper in this app reads
// its own constrained columns (e.g. postgres-sim-outbox-store.ts).

function readRegion(value: string): Region {
  if (value === "AU" || value === "ID") return value;
  throw new Error(`identity.user_profile.region has an unexpected value: ${value}`);
}

function readDisplayLocale(value: string): "en-AU" | "id-ID" {
  if (value === "en-AU" || value === "id-ID") return value;
  throw new Error(`identity.user_profile.display_locale has an unexpected value: ${value}`);
}

function readParentConsentStatus(value: string): ParentConsentStatus {
  if (value === "not_required" || value === "pending" || value === "granted") return value;
  throw new Error(`identity.user_profile.parent_consent_status has an unexpected value: ${value}`);
}

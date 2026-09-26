import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/**
 * `identity.user_profile` (1.4.a). `ageBand` is deliberately absent from
 * every shape here — it is computed at read time
 * (`@yourtal/jurisdiction/age`), never stored, and this repository only
 * ever hands back what the row actually holds.
 */
export type ParentConsentStatus = "not_required" | "pending" | "granted";

export interface NewUserProfile {
  readonly userId: string;
  readonly region: Region;
  readonly displayLocale: "en-AU" | "id-ID";
  readonly displayName: string;
  /** ISO date (`YYYY-MM-DD`). */
  readonly dateOfBirth: string;
  readonly timezone: string;
  readonly guardianEmail: string | null;
  readonly parentConsentStatus: ParentConsentStatus;
}

export interface StoredUserProfile extends NewUserProfile {
  readonly trustTier: number;
  readonly suspendedAt: Date | null;
}

/** The two fields `PATCH /api/me` may change (1.4.d) — never `region`. */
export interface UserProfileUpdate {
  readonly displayName?: string;
  readonly displayLocale?: "en-AU" | "id-ID";
}

export interface UserProfileRepository {
  /**
   * `tx` (2.5/F31): an open transaction to run this insert on, so
   * `AuthService.register` can make this write land or fail together with
   * `identity.credential`'s own insert — see that method's own comment.
   * Omit it for every other caller (e.g. `seedUserProfile`); behaviour is
   * unchanged.
   */
  create(profile: NewUserProfile, tx?: AppDb): Promise<void>;
  findByUserId(userId: string): Promise<StoredUserProfile | null>;
  /** No-op if the user has no profile row — callers that need "exists" check `findByUserId` first. */
  update(userId: string, patch: UserProfileUpdate): Promise<void>;
}

export const USER_PROFILE_REPOSITORY = Symbol("USER_PROFILE_REPOSITORY");

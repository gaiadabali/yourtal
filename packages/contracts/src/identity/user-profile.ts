import { z } from "zod";
import { regionSchema } from "../region/region";

/**
 * The account's own profile — `GET /api/me` (1.4.d), backed by
 * `identity.user_profile` (1.4.a). This is the PUBLIC shape a caller sees
 * about themselves: `trust_tier` is deliberately absent (F12: "the tier is
 * never shown to users"), and so are `guardian_email`/`parent_consent_status`
 * — those stay internal to the identity module until a real
 * guardian-facing flow needs them, which is not this task.
 */

/** Independent of `region` (1.4.a) — a display-language choice, not a jurisdiction. */
export const displayLocaleSchema = z.enum(["en-AU", "id-ID"]);
export type DisplayLocale = z.infer<typeof displayLocaleSchema>;

/**
 * Computed from `date_of_birth` when the profile is read, never stored
 * (1.4.a). Under-13 never reaches here — that age has no account at all
 * (1.4.b) — so this is a closed two-value union, matching
 * `@yourtal/contracts/audience`'s own `AgeBand` (restated here rather than
 * imported so a caller of this contract does not have to pull in audience-
 * targeting types just to read a profile).
 */
export const ageBandSchema = z.enum(["teen", "adult"]);
export type AgeBand = z.infer<typeof ageBandSchema>;

export const userProfileSchema = z.object({
  userId: z.string().min(1),
  region: regionSchema,
  displayLocale: displayLocaleSchema,
  displayName: z.string().min(1).max(120),
  ageBand: ageBandSchema,
  /** The browser's IANA zone captured at signup (e.g. "Australia/Sydney"). */
  timezone: z.string().min(1),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

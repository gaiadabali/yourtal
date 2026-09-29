import type { Pool, PoolClient } from "pg";
import { isQuietHours } from "@yourtal/contracts/me/quiet-hours";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";

/**
 * TASKS.md 12.2.b: "no notifications are sent" to a teen during quiet hours
 * (21:00-07:00 in THEIR OWN profile timezone). Shared by every user-facing
 * notify job (`campaign-published-notify.ts`, `points-unlocked-notify.ts`,
 * `points-expiring-notify.ts`) rather than each re-deriving the same lookup
 * -- one query, one rule, same as `isQuietHours` itself being one function
 * every caller shares.
 *
 * Fails OPEN (never silences) when no profile row exists to prove otherwise
 * -- the same "cannot prove this, so do not guess" reasoning
 * `campaign-published-notify.ts`'s own audience-wall filter already uses,
 * just pointed the other way: a MISSING fact narrows visibility there
 * (skip), but here it would WIDEN a silence, so absence means "send".
 */
export async function isTeenInQuietHours(
  client: Pool | PoolClient,
  userId: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await client.query<{ date_of_birth: string | null; timezone: string | null }>(
    `SELECT date_of_birth::text AS date_of_birth, timezone FROM identity.user_profile WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (row?.date_of_birth == null || row.timezone == null) return false;
  const ageBand = ageBandFrom(ageYearsFrom(row.date_of_birth, now));
  return ageBand === "teen" && isQuietHours(now, row.timezone);
}

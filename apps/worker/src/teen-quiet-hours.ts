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
interface ProfileRow {
  readonly date_of_birth: string | null;
  readonly timezone: string | null;
}

async function profileFor(
  client: Pool | PoolClient,
  userId: string,
): Promise<ProfileRow | undefined> {
  const { rows } = await client.query<ProfileRow>(
    `SELECT date_of_birth::text AS date_of_birth, timezone FROM identity.user_profile WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function isTeenInQuietHours(
  client: Pool | PoolClient,
  userId: string,
  now: Date,
): Promise<boolean> {
  const row = await profileFor(client, userId);
  if (row?.date_of_birth == null || row.timezone == null) return false;
  const ageBand = ageBandFrom(ageYearsFrom(row.date_of_birth, now));
  return ageBand === "teen" && isQuietHours(now, row.timezone);
}

/**
 * 12.4.d/#7: whether the account is a teen at all, with no quiet-hours
 * condition — `points-expiring-notify.ts` uses this to suppress the expiry
 * nudge entirely, not only overnight (`isTeenInQuietHours` above stays the
 * narrower "silence overnight only" rule the other jobs still want). Same
 * fail-open reasoning as above: a missing date of birth never claims "teen".
 */
export async function isTeenAccount(
  client: Pool | PoolClient,
  userId: string,
  now: Date,
): Promise<boolean> {
  const row = await profileFor(client, userId);
  if (row?.date_of_birth == null) return false;
  return ageBandFrom(ageYearsFrom(row.date_of_birth, now)) === "teen";
}

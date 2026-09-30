import type { Pool, PoolClient } from "pg";
import { isTeenAccount } from "./teen-quiet-hours";

/**
 * TASKS.md 12.4.b (#8), the SEND decision this time — not merely the
 * settings page's own read. `apps/api`'s `GET /api/me/notifications/
 * preferences` (`notification.repository.ts`'s `pushEnabledDefaultFor`)
 * already reports a teen's default as off when no explicit row exists;
 * this is the same rule applied where a push actually goes out, which is
 * this worker, not that endpoint. The DPIA is explicit that push is off by
 * default for teens — a settings PAGE agreeing with that while the SEND
 * path still defaulted every missing row to on would leave the actual
 * behaviour wrong regardless of what the page claimed.
 *
 * Shared by every user-facing notify job (`points-unlocked-notify.ts`,
 * `points-expiring-notify.ts`, `campaign-published-notify.ts`) rather than
 * each re-deriving the same lookup -- same "one query, one rule" reasoning
 * `teen-quiet-hours.ts`'s own header gives for itself, and built the same
 * shape: `client`/`userId`/`now`, one exported async function.
 *
 * An explicit stored row ALWAYS wins, teen or not -- this is only ever
 * consulted when `me.notification_preference` has nothing for this
 * (user, category) pair. The age band itself is `teen-quiet-hours.ts`'s own
 * `isTeenAccount` (12.4.d/#7) rather than a second copy of the same
 * date-of-birth lookup -- that function already fails OPEN (false, i.e.
 * "not a teen") when no profile exists to prove otherwise, which is exactly
 * the direction this needs too: a missing fact must not WIDEN a silence.
 */
export async function isPushEnabledFor(
  client: Pool | PoolClient,
  userId: string,
  category: string,
  now: Date,
): Promise<boolean> {
  const preference = await client.query<{ push_enabled: boolean }>(
    `SELECT push_enabled FROM me.notification_preference WHERE user_id = $1 AND category = $2`,
    [userId, category],
  );
  const stored = preference.rows[0]?.push_enabled;
  if (stored !== undefined) return stored;

  return !(await isTeenAccount(client, userId, now));
}

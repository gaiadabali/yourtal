import type { Pool } from "pg";
import { createPool } from "../pool";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { defineJob } from "../job";

/**
 * TASKS.md 12.4.b (#4): a daily sweep that clears
 * `identity.guardian_consent.guardian_email` once the account it belongs to
 * has turned 18. At that point the account is an adult under its own
 * consent (`identity.user_profile.parent_consent_status` no longer gates
 * anything for it — `policies/campaign_view.yaml`'s teen-earns-only rule
 * reads `guardianConsent` off the PRINCIPAL, not this table), and the
 * address the consent flow needed while they were a minor has nothing left
 * to justify keeping it.
 *
 * Never touches `approved_at`/`revoked_at`/`guardian_confirmed_adult_at` —
 * the row's own consent HISTORY stays (12.1.a's own "revoked is final for
 * this link" and the audit value `guardian_confirmed_adult_at`'s own
 * migration comment names), only the guardian's address is cleared.
 * Idempotent by construction: a row already NULL is simply not matched by
 * `WHERE guardian_email IS NOT NULL` on the next run.
 */

let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

/** Exported for direct invocation from tests, same convention as `runStreakBackstop`. */
export async function runGuardianEmailPurge(db: Pool, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query<{ user_id: string; date_of_birth: string }>(
    `SELECT gc.user_id, p.date_of_birth::text AS date_of_birth
       FROM identity.guardian_consent gc
       JOIN identity.user_profile p ON p.user_id = gc.user_id
      WHERE gc.guardian_email IS NOT NULL`,
  );

  const turned18 = rows
    .filter((row) => ageBandFrom(ageYearsFrom(row.date_of_birth, now)) === "adult")
    .map((row) => row.user_id);

  if (turned18.length === 0) return 0;

  const result = await db.query(
    `UPDATE identity.guardian_consent
        SET guardian_email = NULL, updated_at = now()
      WHERE user_id = ANY($1)`,
    [turned18],
  );
  return result.rowCount ?? 0;
}

export const job = defineJob({
  queue: "identity.guardian_email_purge",
  // Once a day is plenty — a birthday landing a day late costs nobody
  // anything, unlike the streak backstop's own per-region timing concern.
  schedule: "0 4 * * *",
  async handle(_job, { config }) {
    await runGuardianEmailPurge(poolFor(config.databaseUrl), new Date());
  },
});

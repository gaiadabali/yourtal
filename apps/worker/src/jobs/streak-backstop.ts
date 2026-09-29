import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import {
  advanceStreak,
  INITIAL_STREAK_STATE,
  regionDateString,
  streakGrantIdempotencyKey,
} from "@yourtal/contracts/me/streak";
import type { StreakState } from "@yourtal/contracts/me/streak";
import { DEFAULT_HOLDBACK_HOURS_BY_TIER } from "@yourtal/contracts/ledger-internal/rewards";
import type { TrustTier } from "@yourtal/contracts/ledger-internal/rewards";
import { toPoints } from "@yourtal/contracts/money";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { defineJob } from "../job";
import { createWorkerLedgerClient } from "../ledger-client";
import type { WorkerLedgerClient } from "../ledger-client";

/**
 * 5.5.d's daily backstop: a user who never re-opens the app after crossing
 * day 3 or day 7 still gets paid, without depending on `GET /api/me/streak`
 * or the (not-yet-wired — see this session's report) completion hook.
 *
 * Self-contained raw `pg` against the SAME tables `apps/api`'s
 * `StreakService`/`StreakStateRepository` use (`me.streak_state`,
 * `watch.session`, `platform.region_setting`, and, in fake-ledger mode,
 * `platform.ledger_fake_grant`) — apps/worker has no Drizzle client and may
 * not import apps/api's (see `points-unlocked-notify.ts`'s own note on the
 * same rule). Reuses the one pure transition every caller shares
 * (`@yourtal/contracts/me/streak`) rather than re-deriving it.
 *
 * ## Why this is safe next to the API's own sync (5.5.d's race)
 *
 * `SELECT ... FOR UPDATE` on `me.streak_state` is a real Postgres row lock,
 * enforced by the database regardless of which process or connection holds
 * it — so a tick here and a concurrent `GET /api/me/streak` (or the
 * completion hook, once wired) for the SAME user genuinely cannot both be
 * inside their read-modify-write at once. Whichever gets the lock first
 * sees `day3Granted`/`day7Granted` as they stand, grants what is left to
 * grant, and only THEN releases it — the second one re-reads the first
 * one's own result and finds nothing left to do. `streakGrantIdempotencyKey`
 * is the same key `StreakService` computes, so even a bug in this locking
 * would still only ever add a second ROW to `ledger_fake_grant` on a
 * genuinely different key, never re-grant the same one twice.
 *
 * ## Schedule: hourly, not "at each region's own midnight"
 *
 * F16 is about which CALENDAR DAY a session counts for (`regionDateString`,
 * unaffected by when this job happens to run) — not about when the backstop
 * itself ticks. A fixed UTC cron aimed at Sydney's midnight would be wrong
 * for half the year (`Australia/Sydney` observes DST; `Asia/Jakarta` does
 * not), and idempotent catch-up makes running this MORE often strictly
 * safer, never wrong — so hourly, covering both regions' boundaries within
 * an hour of either, was chosen over two DST-fragile per-region crons.
 * Proposed decision, not asked of the founder (effort budget; see report).
 *
 * ## `LEDGER_MODE=live` (11.5.h)
 *
 * `runStreakBackstop`'s optional third argument is a `WorkerLedgerClient`
 * (this repo's own `apps/worker/src/ledger-client.ts`, the same signed-HTTP
 * pattern `points-unlocked.ts` already uses). When given, a bonus grants
 * through the real ledger's `/v1/actions/grants` (`grantAction`) instead of
 * `platform.ledger_fake_grant`, and the LOCAL coverage-ratio pause check
 * below is skipped entirely — that math reads `platform.ledger_fake_*`
 * tables, which a real ledger never populates; the real ledger's own
 * `RiskGate`/solvency check (10.4.a, 4.9.c) is what actually gates a live
 * grant, and a non-2xx from it is treated the same as `paused` (the day
 * count stands, the bonus flag reverts to false so a later tick retries).
 * `job.handle` passes one whenever `config.ledger.mode === "live"`.
 */

const REGIONS = ["AU", "ID"] as const;
type Region = (typeof REGIONS)[number];

/** Covers the day-7 bonus with slack; a wider window only means more (cheap, idempotent) candidates checked. */
const LOOKBACK_DAYS = 9;
const LOOKBACK_FLOOR_DAYS = 400; // matches `completed-watch-days.reader.ts`'s own bound

/** `YYYY-MM-DD` from a `date`-column value node-pg already parsed into a `Date`. */
function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= new Pool({ connectionString: databaseUrl });
  return pool;
}

interface Candidate {
  readonly userId: string;
  readonly dateOfBirth: string;
  readonly trustTier: TrustTier;
}

async function candidatesFor(db: Pool, region: Region, now: Date): Promise<Candidate[]> {
  // `now` (the caller's clock, real or a test's), never SQL's own `now()` —
  // a test driving this with a past/future clock must see exactly the
  // window ITS clock implies, not the database server's real wall time.
  const floor = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await db.query<{
    user_id: string;
    date_of_birth: string;
    trust_tier: number;
  }>(
    `SELECT p.user_id, p.date_of_birth::text AS date_of_birth, p.trust_tier
       FROM identity.user_profile p
      WHERE p.region = $1
        AND EXISTS (
          SELECT 1 FROM watch.session ws
           WHERE ws.user_id::text = p.user_id
             AND ws.state = 'completed'
             AND ws.completed_at > $2
        )`,
    [region, floor],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    dateOfBirth: row.date_of_birth,
    trustTier: row.trust_tier as TrustTier,
  }));
}

/** Mirrors `completed-watch-days.reader.ts`'s own logic exactly (5.5.a). */
async function completedDaysSince(
  client: PoolClient,
  userId: string,
  region: Region,
  sinceDate: string | null,
  now: Date,
): Promise<string[]> {
  const floor =
    sinceDate === null
      ? new Date(now.getTime() - LOOKBACK_FLOOR_DAYS * 24 * 60 * 60 * 1000)
      : new Date(`${sinceDate}T00:00:00Z`);
  const { rows } = await client.query<{ completed_at: Date }>(
    `SELECT completed_at FROM watch.session
      WHERE user_id::text = $1 AND state = 'completed' AND completed_at ${sinceDate === null ? ">=" : ">"} $2`,
    [userId, floor],
  );
  const days = new Set<string>();
  for (const row of rows) {
    const day = regionDateString(new Date(row.completed_at), region);
    if (sinceDate === null || day > sinceDate) days.add(day);
  }
  return [...days].sort();
}

async function getSetting(client: PoolClient, region: Region, key: string): Promise<unknown> {
  const { rows } = await client.query<{ value: unknown }>(
    `SELECT value FROM platform.region_setting
      WHERE region = $1 AND key = $2 AND approved_by IS NOT NULL AND effective_from <= now()
      ORDER BY effective_from DESC LIMIT 1`,
    [region, key],
  );
  return rows[0]?.value;
}

/** Mirrors `fake-ledger-economy.ts`'s `coverage()` formula exactly (1.2.a). */
async function coverageRatio(
  client: PoolClient,
  region: Region,
): Promise<{ ok: true; nothingOwed: boolean; ratio: number } | { ok: false }> {
  const rate = await client.query<{ backing_rate_micros_per_pt: string }>(
    `SELECT backing_rate_micros_per_pt FROM platform.ledger_fake_backing_rate
      WHERE region = $1 ORDER BY effective_from DESC LIMIT 1`,
    [region],
  );
  const rateRow = rate.rows[0];
  if (rateRow === undefined) return { ok: false };
  const reserve = await client.query<{ reserve: string }>(
    `SELECT COALESCE(SUM(paid_minor), 0) AS reserve FROM platform.ledger_fake_point_purchase WHERE region = $1`,
    [region],
  );
  const outstanding = await client.query<{ outstanding: string }>(
    `SELECT COALESCE(SUM(points), 0) AS outstanding FROM platform.ledger_fake_grant WHERE region = $1 AND NOT reversed`,
    [region],
  );
  const reserveMinor = Number(reserve.rows[0]?.reserve ?? 0);
  const pointsOutstanding = Number(outstanding.rows[0]?.outstanding ?? 0);
  const backingRateMicros = Number(rateRow.backing_rate_micros_per_pt);
  const outstandingValueMinor = (pointsOutstanding * backingRateMicros) / 1_000_000;
  const nothingOwed = outstandingValueMinor === 0;
  return { ok: true, nothingOwed, ratio: nothingOwed ? 0 : reserveMinor / outstandingValueMinor };
}

/** Inserts a `streak` grant, catching the idempotency key's own unique-violation race (defensive; see header). */
async function insertFakeGrant(
  client: PoolClient,
  params: {
    userId: string;
    region: Region;
    points: number;
    trustTier: TrustTier;
    idempotencyKey: string;
  },
): Promise<void> {
  const holdbackHours = DEFAULT_HOLDBACK_HOURS_BY_TIER[params.trustTier];
  try {
    await client.query(
      `INSERT INTO platform.ledger_fake_grant
         (id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key, campaign_id)
       VALUES ($1, 'streak', $2, $3, $4, now() + make_interval(hours => $5), now(), $6, NULL)`,
      [
        randomUUID(),
        params.userId,
        params.region,
        params.points,
        holdbackHours,
        params.idempotencyKey,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return; // already granted — see header
    throw error;
  }
}

async function processCandidate(
  db: Pool,
  region: Region,
  candidate: Candidate,
  now: Date,
  liveLedger: WorkerLedgerClient | undefined,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Row must exist before `FOR UPDATE` can lock it — same as
    // `StreakStateRepository.runExclusive`'s own insert-if-missing.
    await client.query(
      `INSERT INTO me.streak_state (user_id, region, current_length, last_counted_date, day3_granted, day7_granted, updated_at)
       VALUES ($1, $2, 0, NULL, false, false, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [candidate.userId, region],
    );
    const { rows } = await client.query<{
      current_length: number;
      // node-pg parses `date` columns into a JS `Date` by default (unlike
      // Drizzle's own `mode: "string"` in `streak-state.repository.ts`) —
      // converted below, never used as-is.
      last_counted_date: Date | null;
      day3_granted: boolean;
      day7_granted: boolean;
    }>(
      `SELECT current_length, last_counted_date, day3_granted, day7_granted
         FROM me.streak_state WHERE user_id = $1 FOR UPDATE`,
      [candidate.userId],
    );
    const row = rows[0];
    const before: StreakState =
      row === undefined
        ? INITIAL_STREAK_STATE
        : {
            currentLength: row.current_length,
            lastCountedDate:
              row.last_counted_date === null ? null : dateOnlyString(row.last_counted_date),
            day3Granted: row.day3_granted,
            day7Granted: row.day7_granted,
          };

    const days = await completedDaysSince(
      client,
      candidate.userId,
      region,
      before.lastCountedDate,
      now,
    );
    let finalState = before;
    if (days.length > 0) {
      const { state: advanced, bonuses } = advanceStreak(before, days);
      finalState = advanced;
      const isTeen = ageBandFrom(ageYearsFrom(candidate.dateOfBirth, now)) === "teen";
      if (bonuses.length > 0 && !isTeen) {
        const bonusPoints = (await getSetting(client, region, "streak_bonus_points")) as
          { day3?: unknown; day7?: unknown } | undefined;
        const pauseThresholdRaw = await getSetting(
          client,
          region,
          "streak_coverage_pause_threshold",
        );
        const pauseThreshold = typeof pauseThresholdRaw === "number" ? pauseThresholdRaw : 1.1;

        for (const bonus of bonuses) {
          const points = bonus.day === 3 ? bonusPoints?.day3 : bonusPoints?.day7;
          if (typeof points !== "number") continue; // malformed/missing setting — defer rather than crash the tick

          if (liveLedger === undefined) {
            const coverage = await coverageRatio(client, region);
            const paused =
              !coverage.ok || (!coverage.nothingOwed && coverage.ratio < pauseThreshold);
            if (paused) {
              finalState =
                bonus.day === 3
                  ? { ...finalState, day3Granted: false }
                  : { ...finalState, day7Granted: false };
              continue;
            }
            await insertFakeGrant(client, {
              userId: candidate.userId,
              region,
              points,
              trustTier: candidate.trustTier,
              idempotencyKey: streakGrantIdempotencyKey(candidate.userId, bonus),
            });
            continue;
          }

          // 11.5.h: LEDGER_MODE=live — the real ledger's own RiskGate/
          // solvency check is what gates this, not the local fake-table
          // math above. A refusal is deferred exactly like `paused`.
          try {
            await liveLedger.grantAction({
              kind: "streak",
              userId: candidate.userId,
              region,
              points: toPoints(points),
              trustTier: candidate.trustTier,
              idempotencyKey: streakGrantIdempotencyKey(candidate.userId, bonus),
            });
          } catch (error) {
            finalState =
              bonus.day === 3
                ? { ...finalState, day3Granted: false }
                : { ...finalState, day7Granted: false };
            console.warn(
              `streak-backstop: live grant deferred for user=${candidate.userId} day=${String(bonus.day)}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    await client.query(
      `UPDATE me.streak_state
          SET region = $2, current_length = $3, last_counted_date = $4,
              day3_granted = $5, day7_granted = $6, updated_at = now()
        WHERE user_id = $1`,
      [
        candidate.userId,
        region,
        finalState.currentLength,
        finalState.lastCountedDate,
        finalState.day3Granted,
        finalState.day7Granted,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Exported for direct invocation from tests, same convention as
 * `announceUnlockedPoints`. `liveLedger` is `undefined` for the fake-ledger
 * path (every existing test call omits it, unchanged); pass one to grant
 * through the real ledger instead (11.5.h).
 */
export async function runStreakBackstop(
  db: Pool,
  now: Date = new Date(),
  liveLedger?: WorkerLedgerClient,
): Promise<void> {
  for (const region of REGIONS) {
    const candidates = await candidatesFor(db, region, now);
    for (const candidate of candidates) {
      await processCandidate(db, region, candidate, now, liveLedger);
    }
  }
}

export const job = defineJob({
  queue: "me.streak_backstop",
  schedule: "17 * * * *",
  async handle(_job, { config }) {
    const liveLedger =
      config.ledger.mode === "live" ? createWorkerLedgerClient(config.ledger) : undefined;
    await runStreakBackstop(poolFor(config.databaseUrl), new Date(), liveLedger);
  },
});

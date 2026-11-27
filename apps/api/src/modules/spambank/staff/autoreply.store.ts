import type { QueryResultRow } from "pg";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import type {
  BlocklistCheck,
  SpambankAutoreply,
  SpambankAutoreplyChange,
} from "@yourtal/contracts/spambank/staff";
import type { Queryable } from "../ingest/db";

/**
 * BUILD.md 5.4: the auto-reply panel. The state lives on the singleton `spambank.control` row (the staff
 * kill switch, the auto-pause and the daily cap) plus today's counters and the latest blocklist results.
 */
interface ControlRow extends QueryResultRow {
  tripped_at: Date | null;
  paused_at: Date | null;
  paused_reason: string | null;
  daily_cap: number;
}

interface DayRow extends QueryResultRow {
  sent: number;
  bounces: number;
  complaints: number;
}

interface BlocklistRow extends QueryResultRow {
  checked_at: Date;
  target: string;
  list: string;
  result: BlocklistCheck["result"];
  detail: string | null;
}

export async function readAutoreply(
  db: Queryable,
  mode: AutoreplyMode,
): Promise<SpambankAutoreply> {
  const control = await db.query<ControlRow>(
    "SELECT tripped_at, paused_at, paused_reason, daily_cap FROM spambank.control",
  );
  // The UTC date, the same day the claim transaction counts against.
  const day = await db.query<DayRow>(
    `SELECT sent, bounces, complaints FROM spambank.autoreply_day
      WHERE day = (now() AT TIME ZONE 'UTC')::date`,
  );
  const blocklist = await db.query<BlocklistRow>(
    `SELECT DISTINCT ON (target, list) checked_at, target, list, result, detail
       FROM spambank.blocklist_check
      ORDER BY target, list, checked_at DESC, id DESC`,
  );
  const row = control.rows[0];
  if (row === undefined) throw new Error("spambank.control has no row: the migration seeds it");
  const today = day.rows[0];
  return {
    mode,
    tripped: row.tripped_at !== null,
    pausedAt: row.paused_at?.toISOString() ?? null,
    pausedReason: row.paused_reason,
    dailyCap: row.daily_cap,
    today: {
      sent: today?.sent ?? 0,
      bounces: today?.bounces ?? 0,
      complaints: today?.complaints ?? 0,
    },
    lastBlocklist: blocklist.rows.map((check) => ({
      checkedAt: check.checked_at.toISOString(),
      target: check.target,
      list: check.list,
      result: check.result,
      detail: check.detail,
    })),
  };
}

/**
 * One UPDATE on the singleton row, so a trip, a cap change and a resume land together. Lowering the cap is
 * always allowed: the cap trigger guards only `autoreply_day.sent`.
 */
export async function changeAutoreply(
  db: Queryable,
  change: SpambankAutoreplyChange,
  actorId: string,
): Promise<void> {
  const trip = change.tripped === true;
  const untrip = change.tripped === false;
  await db.query(
    `UPDATE spambank.control SET
       tripped_at     = CASE WHEN $1::boolean THEN COALESCE(tripped_at, now())
                             WHEN $2::boolean THEN NULL ELSE tripped_at END,
       tripped_reason = CASE WHEN $1::boolean THEN $3::text
                             WHEN $2::boolean THEN NULL ELSE tripped_reason END,
       tripped_by     = CASE WHEN $1::boolean THEN $4::text
                             WHEN $2::boolean THEN NULL ELSE tripped_by END,
       daily_cap      = COALESCE($5::integer, daily_cap),
       paused_at      = CASE WHEN $6::boolean THEN NULL ELSE paused_at END,
       paused_reason  = CASE WHEN $6::boolean THEN NULL ELSE paused_reason END,
       updated_by     = $4::text,
       updated_at     = now()`,
    [trip, untrip, change.reason, actorId, change.dailyCap ?? null, change.resume === true],
  );
}

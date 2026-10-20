import type { Pool } from "pg";
import { REGION_TIMEZONE } from "@yourtal/contracts/me/streak";
import { createPool } from "../pool";
import { defineJob } from "../job";
import { createWorkerLedgerClient } from "../ledger-client";
import type { WorkerLedgerClient } from "../ledger-client";
import { createFakeStatementLedger } from "./settlement-statements-fake";
import type { StatementLedger } from "./settlement-statements-fake";

/**
 * 5.2.d (10.1.b): the weekly settlement statement, one per business per region.
 *
 * A week runs Monday 00:00 to the next Monday 00:00 on the REGION's own clock
 * (F16: AU Australia/Sydney, ID Asia/Jakarta), the ISO week and the Monday
 * the ledger's `Region.TimeZone()` and a business's week both start on. Its
 * statement's dispute window (F12, 7 days) starts when the week ends, so a
 * statement is payable a week after that. The job treats a week as closed one
 * hour after its end, so a transaction that began inside it has committed.
 *
 * Every run asks the ledger, per region and for each of the last six closed
 * weeks (oldest first), which businesses are due a statement, and generates
 * those. So the week that just closed gets its statements, and a deploy or a
 * missed run never leaves a gap: the next run fills it, and staging gets
 * statements whose dispute windows have already closed. The ledger answers
 * "due" for a business only when its payable moved that week (or holds a
 * balance no statement ever covered), and never for a week behind a statement
 * that already exists, and generating is idempotent per business, region and
 * period, so a rerun creates nothing. Each statement leaves out money an
 * earlier statement already claims, so weekly statements never pay it twice.
 *
 * Both regions get statements. ID statements are never paid out (F104); that
 * is the disburse job's rule, not this one's.
 */
export const WEEKS_BACK = 6;
const SETTLE_GRACE_MS = 60 * 60 * 1000;
const REGIONS = ["AU", "ID"] as const;
type Region = (typeof REGIONS)[number];

export interface WeekPeriod {
  /** Inclusive, an ISO instant (UTC, `Z`). */
  readonly from: string;
  /** Exclusive. */
  readonly to: string;
}

/** The UTC offset of a zone at an instant, in ms. */
function offsetMs(timeZone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const n = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/** The instant a zone's wall clock reads 00:00 on a calendar day. */
function localMidnightMs(timeZone: string, year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetMs(timeZone, wall);
  const second = wall - offsetMs(timeZone, first);
  return second;
}

/** Start of the region's week (Monday 00:00 local) that holds `instantMs`, as a local date. */
function mondayOf(timeZone: string, instantMs: number): Date {
  const local = new Date(instantMs + offsetMs(timeZone, instantMs));
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceMonday),
  );
}

/**
 * The closed weeks of a region as of `now`, oldest first, at most `count`.
 * Week edges are each Monday's own midnight, so a daylight-saving week is
 * 167 or 169 hours long rather than being shifted an hour.
 */
export function closedWeeks(region: Region, now: Date, count = WEEKS_BACK): WeekPeriod[] {
  const timeZone = REGION_TIMEZONE[region];
  const monday = mondayOf(timeZone, now.getTime() - SETTLE_GRACE_MS);
  const edge = (weeksBack: number) =>
    new Date(
      localMidnightMs(
        timeZone,
        monday.getUTCFullYear(),
        monday.getUTCMonth() + 1,
        monday.getUTCDate() - 7 * weeksBack,
      ),
    ).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    from: edge(count - index),
    to: edge(count - index - 1),
  }));
}

export interface StatementsResult {
  /** Statements generated this run. */
  readonly generated: number;
  /** Businesses the ledger said were due, per week checked. */
  readonly due: number;
}

export async function runSettlementStatements(
  ledger: StatementLedger,
  now: () => Date = () => new Date(),
): Promise<StatementsResult> {
  let generated = 0;
  let due = 0;
  const failures: unknown[] = [];
  for (const region of REGIONS) {
    // Oldest first: a statement leaves out what the ones before it claim.
    for (const week of closedWeeks(region, now())) {
      const businessIds = await ledger.dueBusinesses(region, week.from, week.to);
      due += businessIds.length;
      for (const businessId of businessIds) {
        try {
          await ledger.generate(businessId, region, week.from, week.to);
          generated += 1;
        } catch (error) {
          // One business's failure must not hold the others back; the run still
          // ends in an error below, so it is retried and is visible.
          failures.push(error);
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${String(failures.length)} statements could not be generated (${String(generated)} were)`,
    );
  }
  return { generated, due };
}

/** The live ledger's answers, over the worker's signed HTTP client. */
export function liveStatementLedger(client: WorkerLedgerClient): StatementLedger {
  return {
    async dueBusinesses(region, from, to) {
      return (await client.dueStatements({ region, from, to })).businessIds;
    },
    async generate(businessId, region, from, to) {
      await client.generateStatement({ businessId, region, from, to });
    },
  };
}

let pool: Pool | undefined;

export const job = defineJob({
  queue: "payment.settlement_statements",
  // Hourly: each region's week closes at its own Monday midnight (an hour of
  // grace later, see above), and the run is idempotent.
  schedule: "20 * * * *",
  async handle(_job, { config }) {
    if (config.ledger.mode === "live") {
      await runSettlementStatements(liveStatementLedger(createWorkerLedgerClient(config.ledger)));
      return;
    }
    pool ??= createPool(config.databaseUrl);
    await runSettlementStatements(createFakeStatementLedger(pool));
  },
});

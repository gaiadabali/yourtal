import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type {
  AdvanceDaysResponse,
  DevClockJob,
  ReleasePendingResponse,
  RunJobRequest,
  RunJobResponse,
} from "./dev-clock.schema";

export const DEV_CLOCK_DB_POOL = Symbol("DEV_CLOCK_DB_POOL");
export const DEV_CLOCK_QUEUE_CLIENT = Symbol("DEV_CLOCK_QUEUE_CLIENT");

/**
 * The job `apps/worker/src/jobs/points-unlocked.ts` registers itself on —
 * duplicated here as a string rather than imported, deliberately: `apps/api`
 * does not depend on `apps/worker` (two separate deployables, docs/13b), and
 * `job-loader.ts` auto-loading files under `apps/worker/src/jobs/*.ts`
 * remains the one real registration. This is reviewer-facing metadata only.
 */
const RELEASE_NOTICES_QUEUE = "ledger.release_notices";

/**
 * TASKS.md 2.3.d's own list — holdback release, expiry, settlement accrual,
 * weekly statement, payout, solvency, proof — is what Phase 4/10 will build.
 * Listed here as `built: false` so a reviewer sees what is coming rather
 * than a button that quietly does nothing.
 */
const KNOWN_JOBS: readonly DevClockJob[] = [
  {
    key: "points-unlocked",
    label: "Announce released grants (ledger.points_unlocked)",
    queue: RELEASE_NOTICES_QUEUE,
    schedule: "* * * * *",
    built: true,
  },
  { key: "holdback-release", label: "Holdback release", built: false },
  { key: "expiry", label: "Points expiry", built: false },
  { key: "settlement-accrual", label: "Settlement accrual", built: false },
  { key: "weekly-statement", label: "Weekly statement", built: false },
  { key: "payout", label: "Payout", built: false },
  { key: "solvency", label: "Solvency check", built: false },
  { key: "proof", label: "Proof publication", built: false },
];

/**
 * Why `release-pending`/`advance-days` refuse outright once `LEDGER_MODE=live`
 * (2.3.b's staging note: staging runs live against the real Go ledger).
 * Two independent reasons, either one sufficient on its own:
 *   1. `apps/api`'s `DATABASE_URL` role (`yourtal_app`) has no grant on the
 *      `ledger` schema at all (docs/14 §8, `.env`'s own comment) — there is
 *      no table this process could reach even if it wanted to.
 *   2. The real holdback release (`services/ledger/internal/reward/release.go`,
 *      `ReleaseDue`) runs on the ledger's own internal loop; it exposes no
 *      admin-triggered "release this grant early" RPC today.
 * Flagged here rather than worked around — see this ticket's own report for
 * the follow-up this leaves for whoever owns `services/ledger` next.
 */
const LIVE_MODE_NOTE =
  "Not available while LEDGER_MODE=live: apps/api has no grant on the ledger schema, and " +
  "the real ledger's holdback release has no admin-triggered early-release endpoint yet.";

/**
 * The business logic behind `/dev/clock` (2.3.d). Talks to
 * `platform.ledger_fake_grant` directly with a plain `pg.Pool` — same idiom
 * as `PostgresSimOutboxReader`'s own header explains for `/dev/inbox`: a
 * reviewer-facing read/write path has no reason to go through
 * `LedgerInternalClient`'s full interface (and in fake mode, that interface
 * has no "release early" method to call anyway).
 */
@Injectable()
export class DevClockService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DEV_CLOCK_DB_POOL) private readonly pool: Pool,
    @Inject(DEV_CLOCK_QUEUE_CLIENT) private readonly boss: PgBoss,
  ) {}

  listJobs(): readonly DevClockJob[] {
    return KNOWN_JOBS;
  }

  /** Moves every one of the caller's still-pending grants to unlock now. */
  async releasePending(userId: string): Promise<ReleasePendingResponse> {
    const ledgerMode = this.config.ledger.mode;
    if (ledgerMode !== "fake") {
      await this.audit(userId, "release_pending", { ledgerMode, released: 0 });
      return { ledgerMode, released: 0, note: LIVE_MODE_NOTE };
    }

    const result = await this.pool.query(
      `UPDATE platform.ledger_fake_grant
          SET unlock_at = now()
        WHERE user_id = $1 AND unlock_at > now() AND NOT reversed`,
      [userId],
    );
    const released = result.rowCount ?? 0;
    await this.audit(userId, "release_pending", { ledgerMode, released });
    return { ledgerMode, released };
  }

  /**
   * "Advancing N days" means exactly this in the current codebase: every
   * still-pending grant's `unlock_at` moves N days earlier, the same field
   * `availablePoints`/`ReleaseDue` already read as the one clock that
   * matters. There is no separate simulated wall-clock anywhere to move
   * instead (TASKS.md 2.3.d's own instruction: "don't invent a global
   * clock") — a grant whose shifted `unlock_at` lands in the past becomes
   * available the same way waiting the real N days would have; one that
   * does not stays exactly as pending as before.
   */
  async advanceDays(userId: string, days: number): Promise<AdvanceDaysResponse> {
    const ledgerMode = this.config.ledger.mode;
    if (ledgerMode !== "fake") {
      await this.audit(userId, "advance_days", { ledgerMode, days, shifted: 0 });
      return { ledgerMode, days, shifted: 0, note: LIVE_MODE_NOTE };
    }

    const result = await this.pool.query(
      `UPDATE platform.ledger_fake_grant
          SET unlock_at = unlock_at - ($2 || ' days')::interval
        WHERE user_id = $1 AND unlock_at > now() AND NOT reversed`,
      [userId, days],
    );
    const shifted = result.rowCount ?? 0;
    await this.audit(userId, "advance_days", { ledgerMode, days, shifted });
    return { ledgerMode, days, shifted };
  }

  /**
   * Enqueues one immediate run of the job's own queue — the worker's
   * `boss.work(job.queue, ...)` (apps/worker/src/worker.ts) does not
   * distinguish a cron-scheduled tick from an ad hoc `send`, so this is the
   * same handler `points-unlocked.ts` already runs every minute, just
   * triggered now instead of waited for.
   */
  async runJob(userId: string, job: RunJobRequest["job"]): Promise<RunJobResponse> {
    const queue = RELEASE_NOTICES_QUEUE;
    // `boss.send` refuses a queue that has never been created. The worker's
    // own boot already does this for every job it loads
    // (`apps/worker/src/worker.ts`'s `registerJob`) — this repeats it
    // defensively for the case where this endpoint runs before the worker
    // process has ever started. `createQueue` is safe to call again for a
    // queue that already exists (the worker's own comment on `defineQueue`).
    await defineQueue(this.boss, queue);
    const jobId = await this.boss.send(queue, {});
    if (jobId === null) {
      throw new Error(`pg-boss refused to enqueue a job on "${queue}"`);
    }
    await this.audit(userId, "run_job", { job, queue, jobId });
    return { queue, jobId };
  }

  private async audit(
    userId: string,
    action: "release_pending" | "advance_days" | "run_job",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO platform.dev_clock_audit (id, user_id, action, detail) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, action, JSON.stringify(detail)],
    );
  }
}

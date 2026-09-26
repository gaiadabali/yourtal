import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
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
 * The business logic behind `/dev/clock` (2.3.d). Both actions below go
 * through the ONE `LedgerInternalClient.advanceHoldback` method (1.2.d/2.3.f):
 * `FakeLedgerClient` runs it against `platform.ledger_fake_grant` directly
 * (`fake/fake-ledger-dev.ts`), `HttpLedgerClient` signs a call to the real
 * ledger's own dev-only route (`services/ledger/internal/api/dev_routes.go`,
 * refused with 404 unless the ledger's own `APP_ENV` is dev/staging) — this
 * service does not need to know which. The audit row and the `ledgerMode` on
 * every response are this file's own; the client call underneath is what
 * changed.
 */
@Injectable()
export class DevClockService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DEV_CLOCK_DB_POOL) private readonly pool: Pool,
    @Inject(DEV_CLOCK_QUEUE_CLIENT) private readonly boss: PgBoss,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  listJobs(): readonly DevClockJob[] {
    return KNOWN_JOBS;
  }

  /** Moves every one of the caller's still-pending grants to unlock now. */
  async releasePending(userId: string): Promise<ReleasePendingResponse> {
    const ledgerMode = this.config.ledger.mode;
    const result = await this.ledger.advanceHoldback({ userId, releaseNow: true });
    if (result.isErr()) throw new Error(result.error.message);
    const { released } = result.value;
    const note = this.escrowNote(result.value);
    await this.audit(userId, "release_pending", { ledgerMode, released });
    return { ledgerMode, released, note };
  }

  /**
   * "Advancing N days" means exactly this in the current codebase: every
   * still-pending grant's holdback moves N days closer, the same field
   * `availablePoints`/`ReleaseDue` already read as the one clock that
   * matters. There is no separate simulated wall-clock anywhere to move
   * instead (TASKS.md 2.3.d's own instruction: "don't invent a global
   * clock") — a grant a wait of that length would not yet have released
   * stays exactly as pending as before; `shifted` counts every grant this
   * touched, not only the ones it happened to clear (`advanceHoldback`'s own
   * comment has the full accounting).
   */
  async advanceDays(userId: string, days: number): Promise<AdvanceDaysResponse> {
    const ledgerMode = this.config.ledger.mode;
    const result = await this.ledger.advanceHoldback({ userId, days });
    if (result.isErr()) throw new Error(result.error.message);
    const { shifted } = result.value;
    const note = this.escrowNote(result.value);
    await this.audit(userId, "advance_days", { ledgerMode, days, shifted });
    return { ledgerMode, days, shifted, note };
  }

  /**
   * A held escrow (4.4.g) is the one case worth calling out: some of what
   * this call touched stayed pending for a reason other than "not due yet"
   * — the fake never reports `escrowHeld`, so this is silent in fake mode
   * exactly as it always was.
   */
  private escrowNote(value: {
    shifted: number;
    released: number;
    escrowHeld: boolean;
  }): string | undefined {
    if (!value.escrowHeld) return undefined;
    const remaining = value.shifted - value.released;
    return `${String(remaining)} grant(s) remain pending: this account has a held escrow`;
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

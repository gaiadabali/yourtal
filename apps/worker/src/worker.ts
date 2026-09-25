import type { Job, PgBoss, WorkOptions } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { defineQueue } from "@yourtal/queue/define-queue";
import { loadJobs } from "./job-loader";
import type { LoadedJob } from "./job-loader";

/**
 * Boots a pg-boss client, auto-loads every job under `jobsDir`, and starts
 * working each one's queue. 1.3.c (TASKS.md).
 *
 * Kept separate from `main.ts` so a test can start a worker against a real
 * (test) database, send a job, and stop it again — `main.ts` only adds the
 * process-level concerns (reading `process.env`, exiting on a failed boot,
 * SIGTERM/SIGINT) that a test has no business exercising.
 */
export interface RunningWorker {
  readonly boss: PgBoss;
  readonly jobs: readonly LoadedJob[];
  stop(): Promise<void>;
}

export interface StartWorkerOptions {
  readonly databaseUrl: string;
  readonly jobsDir: string;
  /** Injectable for tests; defaults to `console`. */
  readonly log?: (message: string) => void;
}

export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const log = options.log ?? ((message: string) => console.log(message));
  const boss = createQueueClient({ databaseUrl: options.databaseUrl });
  await boss.start();

  const jobs = await loadJobs(options.jobsDir);
  for (const loaded of jobs) {
    await registerJob(boss, loaded);
    log(`[worker] registered "${loaded.job.queue}" from jobs/${loaded.file}`);
  }
  log(`[worker] ${String(jobs.length)} job(s) loaded, listening`);

  return {
    boss,
    jobs,
    stop: () => boss.stop({ close: true, graceful: true, timeout: 10_000 }),
  };
}

async function registerJob(boss: PgBoss, { job }: LoadedJob): Promise<void> {
  await defineQueue(boss, job.queue, job.queueOptions);

  // One job per `handle()` call, not pg-boss's own batch shape — a job
  // author writes `handle(job)`, not `handle(jobs[])`, and reasons about
  // retries per-job (pg-boss re-delivers the exact row that threw). Default
  // `batchSize: 1` for that; a job can still ask for a bigger batch via
  // `workOptions` and this loop just calls `handle` once per row in it.
  const workOptions: WorkOptions = { batchSize: 1, ...job.workOptions };

  await boss.work(job.queue, workOptions, async (jobs: Job<unknown>[]) => {
    for (const one of jobs) {
      await job.handle(one);
    }
  });
}

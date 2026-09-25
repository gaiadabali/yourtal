import type { Job, PgBoss, WorkOptions } from "pg-boss";
import type { DefineQueueOptions } from "@yourtal/queue/define-queue";
import type { WorkerConfig } from "./config";

/** What the runner hands every `handle` call besides the job itself. */
export interface JobContext {
  /** For jobs that send jobs of their own. */
  readonly boss: PgBoss;
  readonly config: WorkerConfig;
}

/**
 * The shape every file under `src/jobs/*.ts` exports as `job`. 1.3.c
 * (TASKS.md): dropping a new file here is the whole registration — there is
 * no central list of jobs anywhere else to edit. `job-loader.ts` is the only
 * file that reads this shape back off disk.
 */
export interface WorkerJob<TData = unknown> {
  /** The pg-boss queue name. Its dead-letter queue is created alongside it (define-queue.ts). */
  readonly queue: string;
  readonly queueOptions?: DefineQueueOptions;
  readonly workOptions?: WorkOptions;
  /**
   * A cron expression (UTC). The runner schedules an empty job on `queue`
   * at each tick, so a periodic job is still just a job file.
   */
  readonly schedule?: string;
  handle(job: Job<TData>, context: JobContext): Promise<void>;
}

/**
 * Identity function — exists only so a job file can write
 * `export const job = defineJob({ ... })` and get `TData` inferred from
 * `handle`'s parameter, rather than restating it in an explicit type
 * annotation on every file.
 */
export function defineJob<TData = unknown>(job: WorkerJob<TData>): WorkerJob<TData> {
  return job;
}

import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/**
 * `/dev/clock` (2.3.d) — request/response shapes for the three actions and
 * the one job listing. Every response names `ledgerMode` because what each
 * action can actually DO depends on it: fake mode owns
 * `platform.ledger_fake_grant` outright (`yourtal_app`'s own table); live
 * mode does not — `apps/api`'s `DATABASE_URL` role has no grant on the
 * `ledger` schema at all (docs/14 §8's role separation), and the real
 * ledger's holdback release runs on its own internal loop
 * (`services/ledger/internal/reward/release.go`) with no admin-triggered
 * early-release endpoint today. So a live-mode call to `release-pending` or
 * `advance-days` is answered honestly rather than faked, and still audited.
 */

export const runJobRequestSchema = z.object({
  // The only job that exists today (apps/worker/src/jobs/points-unlocked.ts).
  // A closed enum, not `z.string()`, so a request for a job that has not
  // been built yet is a 400, not a silent no-op.
  job: z.literal("points-unlocked"),
});
export type RunJobRequest = z.infer<typeof runJobRequestSchema>;
export class RunJobDto extends createZodDto(runJobRequestSchema) {}

export const advanceDaysRequestSchema = z.object({
  // Bounded well above any holdback window this app defines today
  // (DEFAULT_HOLDBACK_HOURS_BY_TIER, packages/contracts/ledger-internal/rewards.ts)
  // — a typo'd extra zero should not silently shift a grant by decades.
  days: z.number().int().min(1).max(3650),
});
export type AdvanceDaysRequest = z.infer<typeof advanceDaysRequestSchema>;
export class AdvanceDaysDto extends createZodDto(advanceDaysRequestSchema) {}

const ledgerModeSchema = z.enum(["fake", "live"]);

export const releasePendingResponseSchema = z.object({
  ledgerMode: ledgerModeSchema,
  released: z.number().int().min(0),
  note: z.string().optional(),
});
export type ReleasePendingResponse = z.infer<typeof releasePendingResponseSchema>;

export const advanceDaysResponseSchema = z.object({
  ledgerMode: ledgerModeSchema,
  days: z.number().int(),
  shifted: z.number().int().min(0),
  note: z.string().optional(),
});
export type AdvanceDaysResponse = z.infer<typeof advanceDaysResponseSchema>;

export const runJobResponseSchema = z.object({
  queue: z.string(),
  jobId: z.string(),
});
export type RunJobResponse = z.infer<typeof runJobResponseSchema>;

export const devClockJobSchema = z.object({
  key: z.string(),
  label: z.string(),
  queue: z.string().optional(),
  schedule: z.string().optional(),
  built: z.boolean(),
});
export type DevClockJob = z.infer<typeof devClockJobSchema>;

export const devClockJobsResponseSchema = z.object({
  jobs: z.array(devClockJobSchema),
});
export type DevClockJobsResponse = z.infer<typeof devClockJobsResponseSchema>;

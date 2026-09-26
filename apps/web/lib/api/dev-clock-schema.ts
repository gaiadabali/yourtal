import { z } from "zod";

/**
 * `/api/dev/clock`'s response shapes (2.3.d), restated here the same way
 * `me-schema.ts` restates `Me` — `apiFetch` validates every response against
 * one of these before a Server Action ever reads a field off it.
 */

const ledgerModeSchema = z.enum(["fake", "live"]);

export const devClockJobSchema = z.object({
  key: z.string(),
  label: z.string(),
  queue: z.string().optional(),
  schedule: z.string().optional(),
  built: z.boolean(),
});

export const devClockJobsResponseSchema = z.object({
  jobs: z.array(devClockJobSchema),
});
export type DevClockJob = z.infer<typeof devClockJobSchema>;

export const releasePendingResponseSchema = z.object({
  ledgerMode: ledgerModeSchema,
  released: z.number().int(),
  note: z.string().optional(),
});

export const advanceDaysResponseSchema = z.object({
  ledgerMode: ledgerModeSchema,
  days: z.number().int(),
  shifted: z.number().int(),
  note: z.string().optional(),
});

export const runJobResponseSchema = z.object({
  queue: z.string(),
  jobId: z.string(),
});

import { z } from "zod";

/**
 * One dependency's answer. `latencyMs` is on both branches — a check that
 * failed slowly (a timeout) and one that failed instantly (a connection
 * refusal) are different failures, and an operator paged at 3am should not
 * have to go dig a log to tell them apart.
 */
export const checkResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), latencyMs: z.number().nonnegative() }),
  z.object({
    status: z.literal("error"),
    latencyMs: z.number().nonnegative(),
    error: z.string(),
  }),
]);

/**
 * The health endpoint's response shape (see `health.controller.ts`).
 *
 * `status` is `"ok"` only when every check in `checks` is — this object is
 * intentionally redundant with its own fields so a caller that only reads
 * `status` (a load balancer) and a caller that wants to know WHICH
 * dependency is down (an operator, a dashboard) are both served by one
 * response body.
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  // The release SHA this process is running (2.2.c) — `staging-drift.yml`
  // compares it to `main`'s HEAD so a poller that silently stopped is
  // noticed within a day rather than discovered by the founder.
  revision: z.string(),
  checks: z.object({
    postgres: checkResultSchema,
    pdp: checkResultSchema,
  }),
});

export type HealthCheckResult = z.infer<typeof checkResultSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

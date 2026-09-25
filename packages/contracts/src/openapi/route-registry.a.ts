import { z } from "zod";
import { inlineSchema, type RouteDefinition } from "./route-registry-shared";

/**
 * Area A's routes (platform/shared — `apps/api/src/{main.ts,config,shared}/**`
 * and `apps/api/src/modules/{auth,identity,checkout,wallet}/**`, per TASKS.md's
 * "Areas and ownership"). 1.3.a split this out of the old single
 * `route-registry.ts` so Area A can add its own routes here without touching
 * Area B's or Area C's files. See `route-registry-shared.ts` for the common
 * types and OpenAPI-assembly helpers, and `route-registry.ts` for how this
 * file's routes are concatenated with the other areas'.
 */

// --- health.controller.ts ---
//
// The one route with no @Authorize/@PublicRoute story to worry about at all:
// it is `@PublicRoute`d, deliberately (see that file's header — gating a
// Cerbos health check on Cerbos being healthy would hide the very outage it
// reports), and its 503 is not an error in this registry's usual sense — it
// is the SAME HealthResponse schema as its 200, with `status: "degraded"`.

const healthCheckResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), latencyMs: z.number().nonnegative() }),
  z.object({ status: z.literal("error"), latencyMs: z.number().nonnegative(), error: z.string() }),
]);

// Transcribed by hand from apps/api/src/shared/health/health-check.schema.ts, same convention
// as every other apps/api-local DTO in this registry: never promoted to @yourtal/contracts because
// it is a platform-infrastructure shape, not business-domain API surface (see that shared
// module's own reason in the drift test's KNOWN_OUT_OF_SCOPE history and health.controller.ts's
// file header).
const healthResponseSchema = inlineSchema(
  z.object({
    status: z.enum(["ok", "degraded"]),
    checks: z.object({ postgres: healthCheckResultSchema, pdp: healthCheckResultSchema }),
  }),
);

export const HEALTH_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/health",
    summary: "Readiness/liveness probe for Postgres and the PDP",
    tags: ["health"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Both Postgres and the PDP answered within the check timeout.",
    successSchema: healthResponseSchema,
    // Not an authz failure and not this registry's usual error shape — @PublicRoute means no
    // @Authorize runs at all (see health.controller.ts's file header for why: gating this
    // check on the PDP being healthy would hide the very Cerbos outage it exists to report),
    // and the body on this status is the exact same HealthResponse schema as 200, just with
    // `status: "degraded"` and whichever check failed reporting `status: "error"`.
    errors: [
      {
        status: 503,
        description:
          "Postgres or the PDP (or both) failed its check within the 2s timeout " +
          '(health.service.ts) — the same HealthResponse body as 200, with status: "degraded".',
        documented: true,
        schema: healthResponseSchema,
      },
    ],
  },
];

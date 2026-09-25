import { z } from "zod";
import { displayLocaleSchema } from "../identity/user-profile";
import {
  FORBIDDEN,
  VALIDATION_400,
  inlineSchema,
  ref,
  type RouteDefinition,
  type RouteErrorResponse,
} from "./route-registry-shared";

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

// --- me.controller.ts ---
//
// `session` kind, not a new resource kind — there is no `:userId` in either
// route, so the PDP question is the same coarse "does a principal of this
// SHAPE reach this action at all" every other session.yaml action answers.
// Neither route has a domain-thrown refusal of its own the way watch's do:
// a caller who reached the PDP either has a profile (AuthService.register
// always creates one) or gets FORBIDDEN from the guard itself.

const businessMembershipSchema: Record<string, unknown> = {
  type: "object",
  properties: { businessId: { type: "string", format: "uuid" }, role: { type: "string" } },
  required: ["businessId", "role"],
  additionalProperties: false,
};

const meResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "profile is UserProfile. businessMemberships lists only memberships where joined_at is " +
    "set — the full roster is C's /api/me/businesses. staffRoles is always empty until 1.5.b " +
    "adds identity.staff_role.",
  properties: {
    profile: ref("UserProfile"),
    businessMemberships: { type: "array", items: businessMembershipSchema },
    staffRoles: { type: "array", items: { type: "string" } },
  },
  required: ["profile", "businessMemberships", "staffRoles"],
  additionalProperties: false,
};

const updateMeRequestSchema = inlineSchema(
  z.object({
    displayName: z.string().min(1).max(120).optional(),
    displayLocale: displayLocaleSchema.optional(),
  }),
);

/**
 * `to-http-exception.ts`'s only case today: no `identity.user_profile` row
 * for an otherwise-valid session. Should not be reachable in practice —
 * `AuthService.register` always creates one — see that mapper's own comment.
 */
const PROFILE_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No profile exists for this account (me.errors.ts's profile_not_found).",
  documented: true,
};

export const ME_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/me",
    summary: "Get the caller's own account profile",
    tags: ["me"],
    pathParams: [],
    successStatus: 200,
    successDescription: "The caller's own profile, business memberships and staff roles.",
    successSchema: meResponseSchema,
    errors: [FORBIDDEN, PROFILE_NOT_FOUND],
  },
  {
    method: "patch",
    path: "/api/me",
    summary: "Change the caller's own display name and/or locale",
    tags: ["me"],
    pathParams: [],
    requestBody: {
      description: "Display name and/or locale to change. Never region, which is immutable.",
      schema: updateMeRequestSchema,
    },
    successStatus: 200,
    successDescription: "The profile as stored after the change.",
    successSchema: meResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, PROFILE_NOT_FOUND],
  },
];

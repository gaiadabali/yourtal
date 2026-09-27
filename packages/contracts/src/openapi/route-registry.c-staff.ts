import { FORBIDDEN, SERVICE_UNAVAILABLE, type RouteDefinition } from "./route-registry-shared";

/** Area C's staff console routes (TASKS.md Phase 9), `apps/api/src/modules/staff/**`. */

const staffSessionResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    userId: { type: "string" },
    email: { type: ["string", "null"] },
    roles: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: ["support", "moderator", "risk_analyst", "finance", "ops", "admin"],
      },
    },
    region: { type: "string", enum: ["AU", "ID"] },
  },
  required: ["userId", "email", "roles", "region"],
  additionalProperties: false,
};

export const STAFF_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/me",
    summary: "Who is using the staff console, and as which staff roles",
    tags: ["staff"],
    pathParams: [],
    successStatus: 200,
    successDescription: "The caller's own staff roles, email and region.",
    successSchema: staffSessionResponseSchema,
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
];

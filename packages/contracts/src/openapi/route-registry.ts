import { z } from "zod";
import { businessRoleSchema } from "../business/business";
import { businessTeamRoleSchema } from "../business/business-team-role";
import { billingContactSchema } from "../business/billing-contact";
import { kybDocumentTypeSchema } from "../business/kyb-document";
import { COMPONENT_REF_PREFIX, isRecord, widenSchemaObject } from "./json-schema-helpers";

/**
 * The route inventory behind `paths` in the generated document. YT-0552.
 *
 * ## Why this is hand-declared instead of read off Nest decorators
 *
 * `apps/api` uses `@Authorize({...})` and `@Idempotent({...})` for
 * cross-cutting concerns (YT-0500, YT-0039), but nothing in that stack
 * carries a *response* shape, a status code, or which of a use-case's error
 * union members reach the client — that information exists only as the
 * `mapBusinessErrorToHttpException`/`mapAuthzErrorToHttpException` switches
 * and each use-case's return type. Reflecting decorators would produce a
 * document with accurate paths and empty schemas, which is a worse trap than
 * an empty `paths`: it *looks* complete.
 *
 * So each entry below is a transcription, checked by two different things:
 *
 *   1. `route-drift.test.ts` reads `apps/api`'s controllers from source (the
 *      same trick `openapi.test.ts` uses to compare against the checked-in
 *      document) and fails if a controller route and an entry here disagree
 *      on method+path, in either direction.
 *   2. Nothing (yet) checks that the SCHEMA below still matches the DTO or
 *      use-case return type it was transcribed from. That drift is real and
 *      unguarded — flagged here rather than silently assumed away.
 *
 * ## Why request/response shapes are inline, not new named components
 *
 * A handful of these (CreateBusinessRequest, InviteMemberRequest,
 * ChangeMemberRoleRequest, SubmitKybDocumentRequest, the BusinessProfile and
 * CreateBusinessResult response envelopes) have no equivalent in
 * `schema-registry.ts` — they are `apps/api`-local DTOs and use-case return
 * shapes, never promoted to `@yourtal/contracts` (several of their own file
 * comments say so explicitly, e.g. `create-business.schema.ts`). Registering
 * them as new top-level components would be a contract decision — new public
 * API surface — that is not this ticket's to make unilaterally; it would
 * also mint new Go model files sight-unseen. Declaring them inline, right
 * here, documents them precisely without asserting they are meant for reuse
 * beyond this one endpoint. `SetBillingContactRequest` is the one exception:
 * it is exactly `billingContactSchema.omit({ businessId, updatedAt })` in
 * `apps/api`, so it is derived from the real `BillingContact` component
 * rather than re-typed by hand.
 */

/** One `{name}` path parameter, and what it is. */
interface RoutePathParam {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
}

const TENANT_ID_PARAM: RoutePathParam = {
  name: "tenantId",
  description: "The business this route is scoped to (docs/13a's /api/:tenantId/* convention).",
  schema: { type: "string", format: "uuid" },
};

const USER_ID_PARAM: RoutePathParam = {
  name: "userId",
  description: "The member being changed, targeted by their platform user id.",
  schema: { type: "string" },
};

interface RouteErrorResponse {
  readonly status: number;
  readonly description: string;
  /**
   * `false` only for the nestjs-zod validation-pipe 400: it is thrown by
   * `ZodValidationPipe` (`apps/api/src/main.ts`) before a controller or
   * either error mapper runs, and this package has not verified its exact
   * field names against the installed `nestjs-zod` version. Documented by
   * description only, with no `content` schema, rather than assert a shape
   * nobody checked.
   */
  readonly documented: boolean;
}

/** Every route here is `@Authorize`d (YT-0500) and can be refused or fail to evaluate. */
const FORBIDDEN: RouteErrorResponse = {
  status: 403,
  description:
    "The PDP denied this action (authz-error.mapper.ts's `forbidden` case). Also the " +
    "fail-closed response for a route with no @Authorize/@PublicRoute at all — should never " +
    "reach a real deployment; authorized-routes.test.ts catches that at build time.",
  documented: true,
};

/** Cerbos unreachable, or the domain use-case's own persistence step failed. Same envelope either way. */
const SERVICE_UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "Either the PDP could not be reached or returned something this app could not parse " +
    "(authz-error.mapper.ts's pdp_unavailable/pdp_protocol_error, logged server-side and never " +
    "detailed here per docs/14 section 8 A10), or the use-case's own persistence step failed " +
    "(to-http-exception.ts's persistence_failed).",
  documented: true,
};

const BUSINESS_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No business exists with this tenantId (to-http-exception.ts's business_not_found).",
  documented: true,
};

const MEMBER_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No member with this userId on this business (to-http-exception.ts's member_not_found). " +
    "Reuses the same 404 slot as BUSINESS_NOT_FOUND for routes where either can occur — the " +
    "envelope is identical, only `code` differs.",
  documented: true,
};

const MEMBER_ALREADY_EXISTS: RouteErrorResponse = {
  status: 409,
  description:
    "This userId is already a member of this business (to-http-exception.ts's member_already_exists).",
  documented: true,
};

const CANNOT_REMOVE_OWNER: RouteErrorResponse = {
  status: 400,
  description:
    "The target is the business's owner; ownership moves only through transfer_ownership " +
    "(to-http-exception.ts's cannot_remove_owner). Not a validation failure — there is no request " +
    "body on this route — so this 400, unlike VALIDATION_400 below, carries the real ErrorResponse " +
    "envelope.",
  documented: true,
};

/**
 * Every route with a request body can fail nestjs-zod's global validation
 * pipe before the handler runs. See the field comment on `documented` above
 * for why this is description-only.
 */
const VALIDATION_400: RouteErrorResponse = {
  status: 400,
  description:
    "The request body failed Zod validation (nestjs-zod's global ZodValidationPipe, " +
    "apps/api/src/main.ts). Its exact response shape is nestjs-zod's own and is not modelled here.",
  documented: false,
};

/** Grantable via invite/change-role — never `owner`, which moves only through transfer_ownership. */
const grantableTeamRoleSchema = businessTeamRoleSchema.exclude(["owner"]);

/** Converts a standalone Zod schema (not one registered as a named component) to inline JSON Schema. */
function inlineSchema(schema: z.ZodType): Record<string, unknown> {
  const json: unknown = z.toJSONSchema(schema, { target: "draft-2020-12" });
  if (!isRecord(json)) throw new Error("expected zod to produce an object schema");
  const { $schema: _schema, $id: _id, ...rest } = json;
  return widenSchemaObject(rest);
}

/** `{ $ref: "#/components/schemas/<id>" }`, pointing at an existing registered component. */
function ref(id: string): { $ref: string } {
  return { $ref: `${COMPONENT_REF_PREFIX}${id}` };
}

// --- request bodies, transcribed from apps/api/src/modules/business/dto/*.schema.ts ---

const createBusinessRequestSchema = inlineSchema(
  z
    .object({
      legalName: z.string().min(1).max(160),
      displayName: z.string().min(1).max(120),
      district: z.string().min(1).max(60),
      roles: z.array(businessRoleSchema).min(1),
      // `.optional()` here, not `.default(null)` like the real apps/api DTO —
      // both mean "the client may omit this key", but `.default(null)`
      // additionally emits a literal `"default": null` into the JSON Schema,
      // and openapi-generator 7.11.0 mishandles that specific combination
      // (a nullable field with no plain registered component behind it):
      // it emits `= null` as a bare Go token in the generated
      // `NewXWithDefaults()` constructor, which does not compile
      // (`undefined: null`). Confirmed by testing both forms — only the
      // `.default(null)` spelling breaks `openapi:go:verify`. `.optional()`
      // documents the same client-facing contract without tripping it.
      logoUrl: z.url().nullable().optional(),
    })
    .refine((value) => new Set(value.roles).size === value.roles.length, {
      message: "roles must not contain duplicates",
      path: ["roles"],
    }),
);

const inviteMemberRequestSchema = inlineSchema(
  z.object({ userId: z.string().min(1), role: grantableTeamRoleSchema }),
);

const changeMemberRoleRequestSchema = inlineSchema(z.object({ role: grantableTeamRoleSchema }));

// The one request body that IS a registered component, minus the two fields
// the client never sends — see the file header on why this is the exception.
const setBillingContactRequestSchema = inlineSchema(
  billingContactSchema.omit({ businessId: true, updatedAt: true }),
);

const submitKybDocumentRequestSchema = inlineSchema(
  z.object({
    documentType: kybDocumentTypeSchema,
    storageRef: z.string().min(1),
    // `.optional()`, not `.default(null)` — see the comment on `logoUrl` in
    // createBusinessRequestSchema above for why.
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  }),
);

// --- response envelopes with no 1:1 registered component ---

/** `business.controller.ts`'s `getBusinessProfile` — see get-business-profile.use-case.ts. */
const businessProfileResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "The business plus onboarding counts. kybDocumentCount/memberCount are counts, not the " +
    "lists themselves — those are separate endpoints (GET .../team, GET .../kyb-documents).",
  properties: {
    business: ref("Business"),
    billingContact: { anyOf: [ref("BillingContact"), { type: "null" }] },
    kybDocumentCount: { type: "integer", minimum: 0 },
    memberCount: { type: "integer", minimum: 0 },
  },
  required: ["business", "billingContact", "kybDocumentCount", "memberCount"],
  additionalProperties: false,
};

/** `create-business.controller.ts` — the founding owner is created atomically with the business. */
const createBusinessResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "A business and its founding Owner membership, created together (docs/17 section 2.1).",
  properties: { business: ref("Business"), owner: ref("BusinessMember") },
  required: ["business", "owner"],
  additionalProperties: false,
};

/** `team-member.controller.ts`'s DELETE — always this literal body on success. */
const removedResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { removed: { const: true } },
  required: ["removed"],
  additionalProperties: false,
};

const billingContactOrNullResponseSchema: Record<string, unknown> = {
  anyOf: [ref("BillingContact"), { type: "null" }],
};

function arrayOf(componentId: string): Record<string, unknown> {
  return { type: "array", items: ref(componentId) };
}

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDefinition {
  readonly method: HttpMethod;
  /** OpenAPI-style template: `:param` from the Nest controller becomes `{param}`. */
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly pathParams: readonly RoutePathParam[];
  readonly requestBody?: { readonly description: string; readonly schema: Record<string, unknown> };
  readonly successStatus: number;
  readonly successDescription: string;
  readonly successSchema: Record<string, unknown>;
  readonly errors: readonly RouteErrorResponse[];
}

/**
 * The 10 routes `apps/api` serves, all from the `business` module, verified
 * against a real boot (see the ticket report). Kept in file order matching
 * `apps/api/src/modules/business/*.controller.ts` for easy side-by-side
 * review, not path order.
 */
export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // --- create-business.controller.ts ---
  {
    method: "post",
    path: "/api/businesses",
    summary: "Create a business and its founding owner",
    tags: ["business"],
    pathParams: [],
    requestBody: {
      description: "The new business's onboarding details.",
      schema: createBusinessRequestSchema,
    },
    successStatus: 201,
    successDescription: "The business was created, with the caller as its Owner.",
    successSchema: createBusinessResponseSchema,
    // CreateBusinessError is PersistenceFailedError only — no 404/409 possible before the row exists.
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
  },

  // --- business.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/business",
    summary: "Get a business's profile",
    tags: ["business"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "The business profile.",
    successSchema: businessProfileResponseSchema,
    errors: [FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // --- team-directory.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/business/team",
    summary: "List a business's team",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every member of this business's team.",
    successSchema: arrayOf("BusinessMember"),
    errors: [FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // --- team-invite.controller.ts ---
  {
    method: "post",
    path: "/api/{tenantId}/business/team/invite",
    summary: "Invite a member to a business's team",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "Who to invite and the role to grant.",
      schema: inviteMemberRequestSchema,
    },
    successStatus: 201,
    successDescription: "The new membership.",
    successSchema: ref("BusinessMember"),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      BUSINESS_NOT_FOUND,
      MEMBER_ALREADY_EXISTS,
      SERVICE_UNAVAILABLE,
    ],
  },

  // --- team-member.controller.ts ---
  {
    method: "patch",
    path: "/api/{tenantId}/business/team/{userId}/role",
    summary: "Change a team member's role",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM, USER_ID_PARAM],
    requestBody: {
      description: "The role to set. Never `owner` — see grantableRoleSchema.",
      schema: changeMemberRoleRequestSchema,
    },
    successStatus: 200,
    successDescription: "The member's updated record.",
    successSchema: ref("BusinessMember"),
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, MEMBER_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "delete",
    path: "/api/{tenantId}/business/team/{userId}",
    summary: "Remove a team member",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM, USER_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The member was removed (or already was not present — this route is idempotent).",
    successSchema: removedResponseSchema,
    errors: [
      CANNOT_REMOVE_OWNER,
      FORBIDDEN,
      BUSINESS_NOT_FOUND,
      MEMBER_NOT_FOUND,
      SERVICE_UNAVAILABLE,
    ],
  },

  // --- billing-contact.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/business/billing-contact",
    summary: "Get a business's billing contact",
    tags: ["business", "billing"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "The billing contact, or null if none has been set yet.",
    successSchema: billingContactOrNullResponseSchema,
    errors: [FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "put",
    path: "/api/{tenantId}/business/billing-contact",
    summary: "Replace a business's billing contact",
    tags: ["business", "billing"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description:
        "A full replacement of the billing contact (idempotent PUT — see @NotValueMoving).",
      schema: setBillingContactRequestSchema,
    },
    successStatus: 200,
    successDescription: "The billing contact as stored.",
    successSchema: ref("BillingContact"),
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // --- kyb-document.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/business/kyb-documents",
    summary: "List a business's submitted KYB documents",
    tags: ["business", "kyb"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every KYB document this business has submitted.",
    successSchema: arrayOf("KybDocument"),
    errors: [FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/business/kyb-documents",
    summary: "Submit a KYB document",
    tags: ["business", "kyb"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The document type and a reference to its stored bytes.",
      schema: submitKybDocumentRequestSchema,
    },
    successStatus: 201,
    successDescription: "The submitted document, in `submitted` status.",
    successSchema: ref("KybDocument"),
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
];

/** One response object; a bare description for an undocumented shape, a schema otherwise. */
function responseObject(
  description: string,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (schema === undefined) return { description };
  return { description, content: { "application/json": { schema } } };
}

function operationObject(route: RouteDefinition): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    [String(route.successStatus)]: responseObject(route.successDescription, route.successSchema),
  };
  for (const error of route.errors) {
    // Two errors sharing one status (e.g. BUSINESS_NOT_FOUND and
    // MEMBER_NOT_FOUND both 404) fold into one response entry — OpenAPI has
    // exactly one response object per status code, and both carry the same
    // ErrorResponse envelope, so the fold loses nothing but the disambiguating
    // prose, joined below rather than picking one description and dropping
    // the other silently.
    const key = String(error.status);
    const existing = responses[key];
    const schema = error.documented ? ref("ErrorResponse") : undefined;
    responses[key] =
      isRecord(existing) && typeof existing.description === "string"
        ? responseObject(`${existing.description} OR: ${error.description}`, schema)
        : responseObject(error.description, schema);
  }

  return {
    summary: route.summary,
    tags: route.tags,
    parameters: route.pathParams.map((param) => ({
      name: param.name,
      in: "path",
      required: true,
      description: param.description,
      schema: param.schema,
    })),
    ...(route.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            description: route.requestBody.description,
            content: { "application/json": { schema: route.requestBody.schema } },
          },
        }),
    responses,
  };
}

/** Builds the `paths` object `build-document.ts` embeds in the document. */
export function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTE_DEFINITIONS) {
    paths[route.path] = { ...paths[route.path], [route.method]: operationObject(route) };
  }
  return paths;
}

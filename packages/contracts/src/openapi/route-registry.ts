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

/** One `?name=` query parameter, and what it is. Unlike a path param, optional by default. */
interface RouteQueryParam {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
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
  /**
   * When `documented` is true, the schema to put in `content` — defaults to
   * `ref("ErrorResponse")` if omitted. An override exists for two real
   * cases, both introduced by the campaign/watch routes (YT-0559), neither
   * of which is the `{code,message}` envelope:
   *
   *   1. A status this API produces from more than one mechanism with more
   *      than one body shape (e.g. a PDP-denied 403 vs. a plain
   *      `ForbiddenException("...")` thrown straight from a controller) —
   *      given as `{ anyOf: [...] }` of every shape that status can carry.
   *   2. A status whose body is a real, known, non-error schema (health's
   *      503 carries the exact same `HealthResponse` shape 200 does).
   */
  readonly schema?: Record<string, unknown>;
}

/**
 * The exact JSON body `@nestjs/common`'s `HttpException` subclasses build
 * when thrown with a plain string message and no options object — e.g.
 * `throw new NotFoundException("No such campaign.")` in
 * `campaign.controller.ts` and `watch.controller.ts`. Confirmed by reading
 * the installed `@nestjs/common` source
 * (`exceptions/http.exception.js`'s `createBody`, `exceptions/not-found
 * .exception.js` etc.): a string first argument always yields exactly these
 * three keys, `error` taking the exception class's default reason phrase
 * ("Not Found", "Bad Request", "Forbidden") since none of these call sites
 * pass a second argument to override it.
 *
 * This is NOT this API's `{code,message}` `ErrorResponse` envelope.
 * `business/to-http-exception.ts` and `authz-error.mapper.ts` both always
 * construct their exceptions from an object (`new NotFoundException({code,
 * message})`), which Nest serialises unchanged — that is what makes
 * `ErrorResponse` "the one error envelope this API actually returns" for
 * the business module. Campaign and watch have no mapper of their own: every
 * domain-level refusal in `campaign.controller.ts` / `watch.controller.ts`
 * throws a bare string, so every one of those responses carries THIS shape
 * instead. A route that also runs through a `@Authorize` PDP check can 403
 * from either mechanism — see the `anyOf` uses below.
 */
const NEST_DEFAULT_ERROR_SCHEMA: Record<string, unknown> = {
  type: "object",
  description:
    "Nest's own default HttpException body for a plain string message — not this API's " +
    "{code,message} ErrorResponse envelope. See NEST_DEFAULT_ERROR_SCHEMA in route-registry.ts.",
  properties: {
    statusCode: { type: "integer" },
    message: { type: "string" },
    error: { type: "string" },
  },
  required: ["statusCode", "message", "error"],
  additionalProperties: false,
};

/**
 * A `RouteErrorResponse` for a plain, undocumented-shape Nest exception —
 * `documented: true` because the shape IS known (`NEST_DEFAULT_ERROR_SCHEMA`
 * above, verified against the installed framework), just not the
 * `ErrorResponse` envelope `documented` originally meant "this is or isn't".
 */
function nestDefaultError(status: number, description: string): RouteErrorResponse {
  return { status, description, documented: true, schema: NEST_DEFAULT_ERROR_SCHEMA };
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

/**
 * The PDP half of `SERVICE_UNAVAILABLE` above, without the persistence-failure clause — campaign
 * and watch have no `to-http-exception.ts`-style domain-error mapper of their own, so a raw
 * persistence failure in either module is an unhandled exception (a plain 500, not documented
 * anywhere in this registry, matching this repo's existing convention for unmapped errors).
 */
const PDP_UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "The PDP could not be reached or returned something this app could not parse " +
    "(authz-error.mapper.ts's pdp_unavailable/pdp_protocol_error, logged server-side and never " +
    "detailed here per docs/14 section 8 A10).",
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
  /** Absent on every business-module route (none take one); campaign's `list` is the first. */
  readonly queryParams?: readonly RouteQueryParam[];
  readonly requestBody?: { readonly description: string; readonly schema: Record<string, unknown> };
  readonly successStatus: number;
  readonly successDescription: string;
  readonly successSchema: Record<string, unknown>;
  readonly errors: readonly RouteErrorResponse[];
}

/**
 * The 10 routes `apps/api` serves from the `business` module specifically, verified against a
 * real boot (see the ticket report). Kept in file order matching
 * `apps/api/src/modules/business/*.controller.ts` for easy side-by-side review, not path order.
 *
 * Left as its own array, rather than folded into one flat list with the campaign/watch/health
 * definitions below, because route-drift.test.ts's business-module describe block asserts this
 * array's length against the business module's own live route count exactly — merging arrays
 * would make that count include routes `liveRoutes(businessModuleSrc)` was never scanning.
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

// =====================================================================================
// Campaign, watch and health routes. YT-0559.
//
// route-registry.ts's file header above explains why request/response shapes are
// transcribed by hand rather than reflected off decorators; everything there applies here
// too. What is specific to this section:
//
//   - Neither campaign.controller.ts nor watch.controller.ts has a to-http-exception.ts-style
//     domain-error mapper. Every domain-level refusal in those two files is a bare
//     `throw new XException("a string")`, which is Nest's OWN default body — statusCode,
//     message, error — not this API's {code,message} ErrorResponse envelope. See
//     NEST_DEFAULT_ERROR_SCHEMA and nestDefaultError() above for the shape and the citation.
//   - Both controllers are `@Authorize`d, so the SAME status can arrive two different ways:
//     a PDP denial (ErrorResponse, via authz-error.mapper.ts) or a domain refusal thrown
//     directly (NEST_DEFAULT_ERROR_SCHEMA). Where a route can produce both under one status,
//     that status gets exactly one hand-written RouteErrorResponse with an `anyOf` of both
//     shapes — never two separate entries, which the fold in operationObject() cannot merge
//     correctly (see the comment there).
//   - health.controller.ts is the one route with no @Authorize/@PublicRoute story to worry
//     about at all: it is `@PublicRoute`d, deliberately (see that file's header — gating a
//     Cerbos health check on Cerbos being healthy would hide the very outage it reports), and
//     its 503 is not an error in this registry's usual sense — it is the SAME HealthResponse
//     schema as its 200, with `status: "degraded"`.
// =====================================================================================

const CAMPAIGN_ID_PARAM: RoutePathParam = {
  name: "campaignId",
  description: "The campaign being read.",
  schema: { type: "string", format: "uuid" },
};

const SESSION_ID_PARAM: RoutePathParam = {
  name: "sessionId",
  description: "The watch session being resumed, progressed, or completed.",
  schema: { type: "string", format: "uuid" },
};

const LIMIT_QUERY_PARAM: RouteQueryParam = {
  name: "limit",
  description:
    "How many campaigns to return. Clamped server-side to [1, 100] regardless of what is " +
    "asked for — an unauthenticated route's own denial-of-service guard (campaign.controller.ts) " +
    "— and defaulted to 30 when absent or not a base-10 integer.",
  required: false,
  schema: { type: "integer" },
};

// --- campaign.controller.ts ---

const campaignsListResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Every campaign currently visible to a viewer. The authoring state (draft/in_review/" +
    "rejected) cannot reach this response — Campaign['status'] has no value capable of " +
    "expressing it, so it is unrepresentable here rather than filtered.",
  properties: { campaigns: arrayOf("Campaign") },
  required: ["campaigns"],
  additionalProperties: false,
};

export const CAMPAIGN_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/campaigns",
    summary: "List visible campaigns for the Earn board",
    tags: ["campaign"],
    pathParams: [],
    queryParams: [LIMIT_QUERY_PARAM],
    successStatus: 200,
    successDescription: "The visible campaigns, most-recently-published first.",
    successSchema: campaignsListResponseSchema,
    errors: [FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/campaigns/{campaignId}",
    summary: "Get one visible campaign",
    tags: ["campaign"],
    pathParams: [CAMPAIGN_ID_PARAM],
    successStatus: 200,
    successDescription: "The campaign.",
    successSchema: ref("Campaign"),
    errors: [
      nestDefaultError(
        404,
        "No such campaign — deliberately the SAME answer whether the id does not exist or " +
          "exists as an unpublished draft (campaign.controller.ts), so this 404 never discloses " +
          "that a draft with this id exists.",
      ),
      FORBIDDEN,
      PDP_UNAVAILABLE,
    ],
  },
];

// --- watch.controller.ts ---
//
// checkpoint.controller.ts, in the same module directory, is NOT here — it stays in
// route-drift.test.ts's KNOWN_OUT_OF_SCOPE ledger under its own YT-0121/YT-0122 entry, which
// this ticket does not touch.

const startWatchSessionRequestSchema = inlineSchema(z.object({ campaignId: z.uuid() }));

const startWatchSessionResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "The new session — superseding any previous active one for this user, since only one " +
    "reward-bearing session per user is live at a time — plus the campaign's duration, so the " +
    "client knows what full coverage means without a second call.",
  properties: { session: ref("WatchSession"), durationSeconds: { type: "integer", minimum: 1 } },
  required: ["session", "durationSeconds"],
  additionalProperties: false,
};

const coverageIntervalSchema: Record<string, unknown> = {
  type: "object",
  description: "A half-open span of playback, in whole seconds: [fromSecond, toSecond).",
  properties: {
    fromSecond: { type: "integer", minimum: 0 },
    toSecond: { type: "integer", minimum: 0 },
  },
  required: ["fromSecond", "toSecond"],
  additionalProperties: false,
};

const resumeSessionResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Everything needed to resume at the first GAP rather than at a stored playhead position, " +
    "which says nothing about whether the middle was actually watched (decision O-4).",
  properties: {
    session: ref("WatchSession"),
    durationSeconds: { type: "integer", minimum: 1 },
    coverage: { type: "array", items: coverageIntervalSchema },
    coveredSeconds: { type: "integer", minimum: 0 },
    fraction: { type: "number", minimum: 0, maximum: 1 },
    gaps: { type: "array", items: coverageIntervalSchema },
  },
  required: ["session", "durationSeconds", "coverage", "coveredSeconds", "fraction", "gaps"],
  additionalProperties: false,
};

// The controller's own local body — NOT watchProgressReportSchema from
// @yourtal/contracts/watch/progress-report, which additionally requires `sessionId`. That field
// arrives as the {sessionId} path param on this route instead, so re-using the named component
// here would document a request body this route does not accept.
const progressReportRequestSchema = inlineSchema(
  z.object({
    fromSeconds: z.number().min(0),
    toSeconds: z.number().min(0),
    reportedAt: z.iso.datetime(),
  }),
);

const progressReportResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Coverage after this report was merged in. `accepted` is always true here — a refused " +
    "report throws instead of returning a body (see the 400 below).",
  properties: {
    accepted: { const: true },
    coveredSeconds: { type: "integer", minimum: 0 },
    fraction: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["accepted", "coveredSeconds", "fraction"],
  additionalProperties: false,
};

const completeSessionResponseSchema: Record<string, unknown> = {
  type: "object",
  description: "Always `{ completed: true }` on success — a refusal throws instead (see the 403 below).",
  properties: { completed: { const: true } },
  required: ["completed"],
  additionalProperties: false,
};

/** The two 404 messages `loadOwnSession` throws — both plain strings, both this same shape. */
const SESSION_NOT_FOUND = nestDefaultError(
  404,
  "No such watch session belonging to this caller (a session owned by someone else 404s " +
    "identically, rather than 403ing and confirming the id exists) — or the campaign it " +
    "belongs to is no longer available.",
);

export const WATCH_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/watch/sessions",
    summary: "Start (or supersede into) a watch session",
    tags: ["watch"],
    pathParams: [],
    requestBody: {
      description: "The campaign to start watching.",
      schema: startWatchSessionRequestSchema,
    },
    successStatus: 201,
    successDescription: "The session was created.",
    successSchema: startWatchSessionResponseSchema,
    errors: [
      nestDefaultError(
        400,
        "The body is missing campaignId, or it is not a UUID. This route parses its own body " +
          "with a local zod schema rather than a createZodDto — the global ZodValidationPipe " +
          "(apps/api/src/main.ts) never runs for it, so VALIDATION_400 above does not apply here.",
      ),
      nestDefaultError(404, "No such campaign."),
      {
        status: 403,
        description:
          "Two mechanisms share this status here. A PDP denial (authz-error.mapper.ts's " +
          "`forbidden` case, action `earn`) returns the ErrorResponse {code,message} envelope. " +
          "A domain refusal thrown directly by watch.controller.ts — the campaign is not " +
          "currently live, or has no published terms to watch under — returns Nest's own " +
          "{statusCode,message,error} body instead. A client cannot tell the two apart by " +
          "status code alone, so both shapes are asserted rather than picking one.",
        documented: true,
        schema: { anyOf: [ref("ErrorResponse"), NEST_DEFAULT_ERROR_SCHEMA] },
      },
      PDP_UNAVAILABLE,
    ],
  },
  {
    method: "get",
    path: "/api/watch/sessions/{sessionId}",
    summary: "Resume a watch session",
    tags: ["watch"],
    pathParams: [SESSION_ID_PARAM],
    successStatus: 200,
    successDescription: "The session, its recorded coverage, and where it still has gaps.",
    successSchema: resumeSessionResponseSchema,
    // No domain-thrown 403 on this path — resume_session never refuses for a reason of its
    // own, so unlike start/progress/complete below, 403 here means only the PDP denial.
    errors: [SESSION_NOT_FOUND, FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/watch/sessions/{sessionId}/progress",
    summary: "Report a span of playback",
    tags: ["watch"],
    pathParams: [SESSION_ID_PARAM],
    requestBody: {
      description: "The span played, in the client's own playback-position seconds.",
      schema: progressReportRequestSchema,
    },
    successStatus: 201,
    successDescription: "The report was accepted and merged into this session's coverage.",
    successSchema: progressReportResponseSchema,
    errors: [
      nestDefaultError(
        400,
        "Either the body is missing fromSeconds/toSeconds/reportedAt, or the report itself was " +
          "refused by judgeProgressReport (watch-progress-report.ts) — not forward-moving, " +
          "faster than realtime, past the campaign's duration, or sub-second after rounding. " +
          "describeRefusal() supplies the message; the shape is the same Nest default either way.",
      ),
      SESSION_NOT_FOUND,
      {
        status: 403,
        description:
          "Two mechanisms share this status here, same as POST /api/watch/sessions. A PDP " +
          "denial (action `earn`) returns ErrorResponse; a domain refusal — this session is " +
          "not `active` (superseded/completed/void) — is thrown directly by watch.controller.ts " +
          "and returns Nest's own body instead.",
        documented: true,
        schema: { anyOf: [ref("ErrorResponse"), NEST_DEFAULT_ERROR_SCHEMA] },
      },
      PDP_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/watch/sessions/{sessionId}/complete",
    summary: "Claim a watch session's reward",
    tags: ["watch"],
    pathParams: [SESSION_ID_PARAM],
    successStatus: 201,
    successDescription:
      "The session earned its reward under decision O-1 (full coverage) — questionsAnswered is " +
      "hard-coded false pending YT-0122's question bank, so this response cannot currently occur.",
    successSchema: completeSessionResponseSchema,
    errors: [
      SESSION_NOT_FOUND,
      {
        status: 403,
        description:
          "Two mechanisms share this status here, same as the other watch routes. A PDP denial " +
          "(action `watch_rewarded`) returns ErrorResponse. A domain refusal — judgeCompletion " +
          "(watch-session.ts) said not_active, coverage_incomplete, questions_unanswered, or " +
          "campaign_not_live — is thrown directly by watch.controller.ts and returns Nest's own " +
          "body instead; describeCompletionRefusal() supplies the message.",
        documented: true,
        schema: { anyOf: [ref("ErrorResponse"), NEST_DEFAULT_ERROR_SCHEMA] },
      },
      PDP_UNAVAILABLE,
    ],
  },
];

// --- health.controller.ts ---

const healthCheckResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), latencyMs: z.number().nonnegative() }),
  z.object({ status: z.literal("error"), latencyMs: z.number().nonnegative(), error: z.string() }),
]);

// Transcribed by hand from apps/api/src/shared/health/health-check.schema.ts, same convention
// as every other apps/api-local DTO in this file: never promoted to @yourtal/contracts because
// it is a platform-infrastructure shape, not business-domain API surface (see that shared
// module's own reason in KNOWN_OUT_OF_SCOPE's history and health.controller.ts's file header).
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
          "(health.service.ts) — the same HealthResponse body as 200, with status: \"degraded\".",
        documented: true,
        schema: healthResponseSchema,
      },
    ],
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
    // the other silently. That "both carry the same envelope" premise is
    // exactly why every `route.errors` list in this file is written so that
    // no two entries sharing a status ever disagree on `schema` — this fold
    // takes the LAST one's schema unconditionally, so a mismatched pair
    // would silently assert whichever happened to be listed last. Where a
    // status genuinely has more than one shape (campaign/watch's mixed
    // PDP/domain 403s below), that is one hand-written entry with an
    // `anyOf`, not two competing entries.
    const key = String(error.status);
    const existing = responses[key];
    const schema = error.documented ? (error.schema ?? ref("ErrorResponse")) : undefined;
    responses[key] =
      isRecord(existing) && typeof existing.description === "string"
        ? responseObject(`${existing.description} OR: ${error.description}`, schema)
        : responseObject(error.description, schema);
  }

  return {
    summary: route.summary,
    tags: route.tags,
    parameters: [
      ...route.pathParams.map((param) => ({
        name: param.name,
        in: "path",
        required: true,
        description: param.description,
        schema: param.schema,
      })),
      ...(route.queryParams ?? []).map((param) => ({
        name: param.name,
        in: "query",
        required: param.required,
        description: param.description,
        schema: param.schema,
      })),
    ],
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
  const allRoutes = [
    ...ROUTE_DEFINITIONS,
    ...CAMPAIGN_ROUTE_DEFINITIONS,
    ...WATCH_ROUTE_DEFINITIONS,
    ...HEALTH_ROUTE_DEFINITIONS,
  ];
  for (const route of allRoutes) {
    paths[route.path] = { ...paths[route.path], [route.method]: operationObject(route) };
  }
  return paths;
}

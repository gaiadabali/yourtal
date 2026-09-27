import { z } from "zod";
import { auStateSchema, businessRoleSchema, taxIdKindSchema } from "../business/business";
import { businessTeamRoleSchema } from "../business/business-team-role";
import { billingContactSchema } from "../business/billing-contact";
import { kybDocumentTypeSchema } from "../business/kyb-document";
import {
  FORBIDDEN,
  SERVICE_UNAVAILABLE,
  VALIDATION_400,
  TENANT_ID_PARAM,
  arrayOf,
  inlineSchema,
  ref,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * Area C's routes (business side — `apps/api/src/modules/{business,studio,
 * store,billing,devices,partners,staff,reports,feed}/**`, per TASKS.md's
 * "Areas and ownership"). 1.3.a split this out of the old single
 * `route-registry.ts` so Area C can add its own routes here without touching
 * Area A's or Area B's files. See `route-registry-shared.ts` for the common
 * types and OpenAPI-assembly helpers, and `route-registry.ts` for how this
 * file's routes are concatenated with the other areas'.
 *
 * ## Response envelopes with no 1:1 registered component
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

const USER_ID_PARAM: RoutePathParam = {
  name: "userId",
  description: "The member being changed, targeted by their platform user id.",
  schema: { type: "string" },
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

const INVITATION_ALREADY_OPEN: RouteErrorResponse = {
  status: 409,
  description:
    "This email already has an open invitation to this business " +
    "(to-http-exception.ts's invitation_already_open).",
  documented: true,
};

const INVITATION_INVALID: RouteErrorResponse = {
  status: 400,
  description:
    "The token is unknown, expired, revoked, or already accepted -- collapsed into one outcome " +
    "on purpose (to-http-exception.ts's invitation_invalid), the same enumeration discipline " +
    "auth's own token_invalid uses.",
  documented: true,
};

const STORAGE_REF_NOT_UPLOADED: RouteErrorResponse = {
  status: 400,
  description:
    "No object exists at this storageRef yet (to-http-exception.ts's storage_ref_not_uploaded) " +
    "-- request a fresh upload URL and upload through it first.",
  documented: true,
};

const TARGET_NOT_MEMBER: RouteErrorResponse = {
  status: 400,
  description:
    "The named new owner (or, in a should-not-happen case, the caller) is not a member of this " +
    "business yet (to-http-exception.ts's target_not_member).",
  documented: true,
};

const CANNOT_REMOVE_OWNER: RouteErrorResponse = {
  status: 400,
  description:
    "The target is the business's owner; ownership moves only through transfer_ownership " +
    "(to-http-exception.ts's cannot_remove_owner). Not a validation failure — there is no request " +
    "body on this route — so this 400, unlike VALIDATION_400, carries the real ErrorResponse " +
    "envelope.",
  documented: true,
};

/** Grantable via invite/change-role — never `owner`, which moves only through transfer_ownership. */
const grantableTeamRoleSchema = businessTeamRoleSchema.exclude(["owner"]);

// --- request bodies, transcribed from apps/api/src/modules/business/dto/*.schema.ts ---

const createBusinessRequestSchema = inlineSchema(
  z
    .object({
      legalName: z.string().min(1).max(160),
      displayName: z.string().min(1).max(120),
      taxIdKind: taxIdKindSchema,
      taxIdValue: z.string().min(1).max(32),
      addressState: auStateSchema.nullable().optional(),
      addressPostcode: z
        .string()
        .regex(/^\d{4}$/)
        .nullable()
        .optional(),
      addressCity: z.string().min(1).max(120).nullable().optional(),
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
  z.object({
    email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
    role: grantableTeamRoleSchema,
  }),
);

const acceptInvitationRequestSchema = inlineSchema(z.object({ token: z.string().min(1) }));

const transferOwnershipRequestSchema = inlineSchema(
  z.object({ newOwnerUserId: z.string().min(1) }),
);

const changeMemberRoleRequestSchema = inlineSchema(z.object({ role: grantableTeamRoleSchema }));

// The one request body that IS a registered component, minus the two fields
// the client never sends — see the file header on why this is the exception.
const setBillingContactRequestSchema = inlineSchema(
  billingContactSchema.omit({ businessId: true, updatedAt: true }),
);

const createKybUploadUrlRequestSchema = inlineSchema(
  z.object({ contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]) }),
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

/** `team-invite.controller.ts`'s response — the invitation record, never the token (it already left, once, by email). */
const teamInvitationResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    email: { type: "string" },
    role: ref("BusinessTeamRole"),
    invitedAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
  },
  required: ["id", "businessId", "email", "role", "invitedAt", "expiresAt"],
  additionalProperties: false,
};

/** `my-businesses.controller.ts`'s `GET /api/me/businesses` — every business the caller has actually joined. */
const myBusinessMembershipsResponseSchema: Record<string, unknown> = {
  type: "array",
  items: {
    type: "object",
    properties: {
      business: ref("Business"),
      role: ref("BusinessTeamRole"),
      joinedAt: { type: "string", format: "date-time" },
    },
    required: ["business", "role", "joinedAt"],
    additionalProperties: false,
  },
};

/** `my-businesses.controller.ts`'s accept-invitation response. */
const acceptInvitationResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { businessId: { type: "string", format: "uuid" }, member: ref("BusinessMember") },
  required: ["businessId", "member"],
  additionalProperties: false,
};

/** `kyb-document.controller.ts`'s `createUploadUrl` — never a full public URL, an opaque object key `submitKybDocument`'s `storageRef` must equal. */
const kybUploadUrlResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    storageRef: { type: "string" },
    uploadUrl: { type: "string", format: "uri" },
    expiresAt: { type: "string", format: "date-time" },
  },
  required: ["storageRef", "uploadUrl", "expiresAt"],
  additionalProperties: false,
};

/** `team-ownership.controller.ts`'s transfer response. */
const transferOwnershipResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { previousOwner: ref("BusinessMember"), newOwner: ref("BusinessMember") },
  required: ["previousOwner", "newOwner"],
  additionalProperties: false,
};

/**
 * The routes `apps/api` serves from the `business` module specifically, verified against a
 * real boot (see the ticket report). Kept in file order matching
 * `apps/api/src/modules/business/*.controller.ts` for easy side-by-side review, not path order.
 */
export const BUSINESS_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
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

  // --- my-businesses.controller.ts ---
  {
    method: "get",
    path: "/api/me/businesses",
    summary: "List every business the caller has joined",
    tags: ["business"],
    pathParams: [],
    successStatus: 200,
    successDescription: "Every business membership the caller has actually joined.",
    successSchema: myBusinessMembershipsResponseSchema,
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/me/businesses/invitations/accept",
    summary: "Accept a team invitation by token",
    tags: ["business", "team"],
    pathParams: [],
    requestBody: {
      description: "The token the invitee received by email.",
      schema: acceptInvitationRequestSchema,
    },
    successStatus: 201,
    successDescription: "The membership the caller just joined.",
    successSchema: acceptInvitationResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, INVITATION_INVALID, SERVICE_UNAVAILABLE],
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
    summary: "Invite a member to a business's team by email",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The invitee's email and the role to grant.",
      schema: inviteMemberRequestSchema,
    },
    successStatus: 201,
    successDescription: "The created invitation (never the token — it was mailed).",
    successSchema: teamInvitationResponseSchema,
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      BUSINESS_NOT_FOUND,
      INVITATION_ALREADY_OPEN,
      SERVICE_UNAVAILABLE,
    ],
  },

  // --- team-ownership.controller.ts ---
  {
    method: "post",
    path: "/api/{tenantId}/business/team/transfer-ownership",
    summary: "Transfer business ownership to an existing team member",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The existing member who becomes the new owner.",
      schema: transferOwnershipRequestSchema,
    },
    successStatus: 200,
    successDescription: "The previous owner (now admin) and the new owner.",
    successSchema: transferOwnershipResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, BUSINESS_NOT_FOUND, TARGET_NOT_MEMBER, SERVICE_UNAVAILABLE],
  },

  // --- team-member.controller.ts ---
  {
    method: "patch",
    path: "/api/{tenantId}/business/team/{userId}/role",
    summary: "Change a team member's role",
    tags: ["business", "team"],
    pathParams: [TENANT_ID_PARAM, USER_ID_PARAM],
    requestBody: {
      description: "The role to set. Never `owner` — see grantableTeamRoleSchema.",
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
    path: "/api/{tenantId}/business/kyb-documents/upload-url",
    summary: "Mint a presigned MinIO upload URL for a KYB document",
    tags: ["business", "kyb"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The content type of the file about to be uploaded.",
      schema: createKybUploadUrlRequestSchema,
    },
    successStatus: 201,
    successDescription: "A presigned PUT and the storageRef it will land at.",
    successSchema: kybUploadUrlResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, SERVICE_UNAVAILABLE],
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
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      BUSINESS_NOT_FOUND,
      STORAGE_REF_NOT_UPLOADED,
      SERVICE_UNAVAILABLE,
    ],
  },
];

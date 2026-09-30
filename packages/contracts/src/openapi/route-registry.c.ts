import * as z from "zod";
import { auStateSchema, businessRoleSchema, taxIdKindSchema } from "../business/business";
import { businessTeamRoleSchema } from "../business/business-team-role";
import { billingContactSchema } from "../business/billing-contact";
import { kybDocumentTypeSchema } from "../business/kyb-document";
import {
  counterDeviceSchema,
  pairDeviceRequestSchema,
  provisionDeviceRequestSchema,
  unlockDeviceRequestSchema,
  unlockDeviceResultSchema,
} from "../device/counter-device";
import { campaignKindSchema, campaignScoringRuleSchema } from "../campaign/campaign";
import { audienceSchema } from "../audience/audience";
import { campaignLifecycleStateSchema } from "../campaign/campaign-lifecycle";
import { campaignChapterSchema } from "../campaign/campaign-chapter";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { regionSchema } from "../region/region";
import { questionSchema } from "../question/question";
import { questionStatusSchema, piiScreenVerdictSchema } from "../question/question-bank";
import { CURRENCY_CODES } from "../money/currency";
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
    summary: "Mint a presigned object-store upload URL for a KYB document",
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

// --- devices.module.ts (TASKS.md 8.1) ---

const DEVICE_ID_PARAM: RoutePathParam = {
  name: "deviceId",
  description: "A counter device, targeted by its own id.",
  schema: { type: "string" },
};

const LOCATION_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "locationId is not one of this business's own (devices.errors.ts's location_not_found).",
  documented: true,
};

const DEVICE_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such device on this business (devices.errors.ts's device_not_found).",
  documented: true,
};

const PAIRING_CODE_INVALID: RouteErrorResponse = {
  status: 400,
  description:
    "Unknown, already-used, revoked or expired — all answer identically, deliberately " +
    "(devices.errors.ts's pairing_code_invalid; see pair-device.use-case.ts's own comment).",
  documented: true,
};

const DEVICE_UNAUTHORIZED: RouteErrorResponse = {
  status: 401,
  description:
    "No credential presented, or the credential is unknown/revoked (store-device-principal-" +
    "resolver.ts's invalid_device_credential), or the device is PIN-locked (devices.errors.ts's " +
    "device_locked), or the PIN was wrong (pin_incorrect).",
  documented: true,
};

const provisionDeviceRequestBodySchema = inlineSchema(provisionDeviceRequestSchema);
const pairDeviceRequestBodySchema = inlineSchema(pairDeviceRequestSchema);
const unlockDeviceRequestBodySchema = inlineSchema(unlockDeviceRequestSchema);

/** `studio-devices.controller.ts`'s `provision` — the pairing code and its expiry, returned once only. */
const provisionDeviceResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    device: inlineSchema(counterDeviceSchema),
    pairingCode: { type: "string" },
    pairingExpiresAt: { type: "string", format: "date-time" },
  },
  required: ["device", "pairingCode", "pairingExpiresAt"],
  additionalProperties: false,
};

const revokedResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { revoked: { const: true } },
  required: ["revoked"],
  additionalProperties: false,
};

/** `device-pairing.controller.ts`'s `pair` — the bearer credential, returned exactly once. */
const pairDeviceResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: { deviceId: { type: "string", format: "uuid" }, credential: { type: "string" } },
  required: ["deviceId", "credential"],
  additionalProperties: false,
};

export const DEVICE_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // --- studio-devices.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/studio/devices",
    summary: "List a business's counter devices",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every counter device this business has provisioned, paired or not.",
    successSchema: arrayOf("CounterDevice"),
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/devices",
    summary: "Provision a counter device",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The location it belongs to, a label, and the PIN staff share to unlock it.",
      schema: provisionDeviceRequestBodySchema,
    },
    successStatus: 201,
    successDescription:
      "The device record, plus a one-time pairing code (15 minutes) shown only this once.",
    successSchema: provisionDeviceResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, LOCATION_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "delete",
    path: "/api/{tenantId}/studio/devices/{deviceId}",
    summary: "Revoke a counter device",
    tags: ["devices", "studio"],
    pathParams: [TENANT_ID_PARAM, DEVICE_ID_PARAM],
    successStatus: 200,
    successDescription: "The device is revoked; its credential stops authenticating immediately.",
    successSchema: revokedResponseSchema,
    errors: [FORBIDDEN, DEVICE_NOT_FOUND, SERVICE_UNAVAILABLE],
  },

  // --- device-pairing.controller.ts ---
  {
    method: "post",
    path: "/api/devices/pair",
    summary: "Claim a provisioned device's credential with its one-time pairing code",
    tags: ["devices"],
    pathParams: [],
    requestBody: {
      description: "The pairing code shown in Studio.",
      schema: pairDeviceRequestBodySchema,
    },
    successStatus: 200,
    successDescription:
      "The device's bearer credential — shown exactly once; there is no later read.",
    successSchema: pairDeviceResponseSchema,
    errors: [VALIDATION_400, PAIRING_CODE_INVALID, SERVICE_UNAVAILABLE],
  },

  // --- device-unlock.controller.ts ---
  {
    method: "post",
    path: "/api/devices/unlock",
    summary: "Unlock a paired counter device with its shared PIN",
    tags: ["devices"],
    pathParams: [],
    requestBody: { description: "The PIN.", schema: unlockDeviceRequestBodySchema },
    successStatus: 200,
    successDescription: "The PIN was correct.",
    successSchema: inlineSchema(unlockDeviceResultSchema),
    errors: [VALIDATION_400, DEVICE_UNAUTHORIZED, SERVICE_UNAVAILABLE],
  },
];

// --- studio.module.ts's campaign-draft/question-bank/reward-config controllers (TASKS.md 7.3) ---

const CAMPAIGN_ID_PARAM: RoutePathParam = {
  name: "campaignId",
  description: "The draft campaign this route acts on, scoped to the tenant's own business.",
  schema: { type: "string", format: "uuid" },
};

const STUDIO_CAMPAIGN_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No campaign with this id belongs to this business (studio.errors.ts's campaign_not_found).",
  documented: true,
};

const CAMPAIGN_NOT_DRAFT: RouteErrorResponse = {
  status: 400,
  description:
    "This campaign has left draft; an advertiser edits freely only until submission " +
    "(studio.errors.ts's campaign_not_draft).",
  documented: true,
};

const CAMPAIGN_AUTHORING_400: RouteErrorResponse = {
  status: 400,
  description:
    "One of: prohibited_category (category is prohibited in this business's region), " +
    "audience_must_be_adult (an adult_only category with a non-adult audience), or " +
    "open_viewing_requires_all_ages (F8: Open Viewing set on anything but an all_ages campaign) " +
    "-- studio.errors.ts.",
  documented: true,
};

const QUESTION_GUARD_400: RouteErrorResponse = {
  status: 400,
  description:
    "The question text reads as a request for personal information (pii_request) or asks the " +
    "viewer to predict/guess an outcome (prediction_request) -- both red-line refusals, " +
    "studio.errors.ts.",
  documented: true,
};

/** TASKS.md 7.3.i. */
const QUESTION_ID_PARAM: RoutePathParam = {
  name: "questionId",
  description: "The question this route acts on, scoped to its own campaign.",
  schema: { type: "string", format: "uuid" },
};

const QUESTION_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No question with this id belongs to this campaign (studio.errors.ts's question_not_found).",
  documented: true,
};

const QUESTION_TYPE_IMMUTABLE: RouteErrorResponse = {
  status: 400,
  description:
    "A question's type cannot change on edit -- retire it and author a new one instead " +
    "(studio.errors.ts's question_type_immutable).",
  documented: true,
};

const REWARD_CONFIG_400: RouteErrorResponse = {
  status: 400,
  description:
    "One of: allocation_not_owned (allocationId is not one of this business's own), " +
    "allocation_not_partner_funded (only a partner-funded allocation may fund a reward), " +
    "reward_exceeds_ceiling (F14: base plus the maximum accuracy bonus exceeds the region's " +
    "reward_ceiling_points_per_minute, scaled to this campaign's duration), or " +
    "accuracy_bonus_too_high (the bonus exceeds 40% of the base reward) -- studio.errors.ts.",
  documented: true,
};

const NOT_KYB_VERIFIED: RouteErrorResponse = {
  status: 403,
  description:
    "This business's KYB has not been verified yet -- submission is refused until it is " +
    "(studio.errors.ts's not_kyb_verified).",
  documented: true,
};

const ILLEGAL_TRANSITION: RouteErrorResponse = {
  status: 400,
  description:
    "The requested lifecycle move is not a legal transition from the campaign's current state " +
    "(studio.errors.ts's illegal_transition; enforced twice over, by the use-case and by " +
    "campaign.assert_lifecycle_transition()'s own database trigger).",
  documented: true,
};

/** The `CampaignDraft` studio's own authoring view returns -- deliberately NOT `campaignSchema` (B's viewer-facing shape); see campaign-draft.repository.ts's own header comment for why. */
const campaignDraftResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    businessId: { type: "string", format: "uuid" },
    region: inlineSchema(regionSchema),
    kind: inlineSchema(campaignKindSchema),
    title: { type: "string" },
    synopsis: { type: "string" },
    durationSeconds: { type: "integer" },
    contentCategory: inlineSchema(contentCategorySchema),
    audience: inlineSchema(audienceSchema),
    lifecycleState: inlineSchema(campaignLifecycleStateSchema),
    rejectionReason: { anyOf: [{ type: "string" }, { type: "null" }] },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    openViewing: { type: "boolean" },
    teaserStartSeconds: { type: "integer" },
    posterFrameSeconds: { anyOf: [{ type: "integer" }, { type: "null" }] },
    declaredInterests: { type: "array", items: { type: "string" } },
    chapters: { type: "array", items: inlineSchema(campaignChapterSchema) },
    captionsUrl: { anyOf: [{ type: "string", format: "uri" }, { type: "null" }] },
    posterUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    teaserUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    hlsUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    rewardPoints: { anyOf: [{ type: "integer" }, { type: "null" }] },
    questionCount: { anyOf: [{ type: "integer" }, { type: "null" }] },
    scoringRule: { anyOf: [inlineSchema(campaignScoringRuleSchema), { type: "null" }] },
    publishedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
  required: [
    "id",
    "businessId",
    "region",
    "kind",
    "title",
    "synopsis",
    "durationSeconds",
    "contentCategory",
    "audience",
    "lifecycleState",
    "rejectionReason",
    "startsAt",
    "endsAt",
    "openViewing",
    "teaserStartSeconds",
    "posterFrameSeconds",
    "declaredInterests",
    "chapters",
    "captionsUrl",
    "posterUrl",
    "teaserUrl",
    "hlsUrl",
    "rewardPoints",
    "questionCount",
    "scoringRule",
    "publishedAt",
  ],
  additionalProperties: false,
};

/**
 * `set-reward-config.use-case.ts`'s `SetRewardConfigResult` -- the draft,
 * plus 7.3.h's reward value priced in the business's own currency via
 * `valuePoints` (P_issue). B, the backing rate, never appears here.
 * `rewardValueMinor`/`currency` are nullable (F61): the reward config
 * itself always saves; a ledger valuation failure after that save degrades
 * to null/null (display-only data) rather than failing the response.
 */
const setRewardConfigResponseSchema: Record<string, unknown> = {
  allOf: [
    campaignDraftResponseSchema,
    {
      type: "object",
      properties: {
        rewardValueMinor: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        currency: { anyOf: [{ type: "string", enum: [...CURRENCY_CODES] }, { type: "null" }] },
      },
      required: ["rewardValueMinor", "currency"],
    },
  ],
};

/** `question-bank.controller.ts`'s `BankQuestionRecord` -- the full authored `Question` (answer key included; this is the author's own view) plus the bank's moderation/leak-tracking state. */
const bankQuestionResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    question: inlineSchema(questionSchema),
    status: inlineSchema(questionStatusSchema),
    piiScreen: { anyOf: [inlineSchema(piiScreenVerdictSchema), { type: "null" }] },
    timesAsked: { type: "integer", minimum: 0 },
    timesCorrect: { type: "integer", minimum: 0 },
    retiredReason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["question", "status", "piiScreen", "timesAsked", "timesCorrect", "retiredReason"],
  additionalProperties: false,
};

const createCampaignDraftRequestBodySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    kind: inlineSchema(campaignKindSchema),
    title: { type: "string", minLength: 1, maxLength: 140 },
    synopsis: { type: "string", minLength: 1, maxLength: 500 },
    durationSeconds: { type: "integer", minimum: 1, maximum: 3 * 60 * 60 },
    contentCategory: inlineSchema(contentCategorySchema),
    audience: inlineSchema(audienceSchema),
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    openViewing: { type: "boolean", default: false },
    teaserStartSeconds: { type: "integer", minimum: 0, default: 0 },
    declaredInterests: { type: "array", items: { type: "string" }, default: [] },
  },
  required: [
    "kind",
    "title",
    "synopsis",
    "durationSeconds",
    "contentCategory",
    "audience",
    "startsAt",
    "endsAt",
  ],
  additionalProperties: false,
};

/** A patch (`update-campaign-draft.schema.ts`) -- every field optional; `chapters`/`declaredInterests`, when present, replace the whole set. */
const updateCampaignDraftRequestBodySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 140 },
    synopsis: { type: "string", minLength: 1, maxLength: 500 },
    durationSeconds: { type: "integer", minimum: 1, maximum: 3 * 60 * 60 },
    contentCategory: inlineSchema(contentCategorySchema),
    audience: inlineSchema(audienceSchema),
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    openViewing: { type: "boolean" },
    teaserStartSeconds: { type: "integer", minimum: 0 },
    posterFrameSeconds: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    declaredInterests: { type: "array", items: { type: "string" } },
    chapters: { type: "array", items: inlineSchema(campaignChapterSchema) },
    captionsUrl: { anyOf: [{ type: "string", format: "uri" }, { type: "null" }] },
  },
  additionalProperties: false,
};

const setRewardConfigRequestBodySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    allocationId: { type: "string", minLength: 1 },
    rewardPointsPerCompletion: { type: "integer", minimum: 0 },
    accuracyBonusPoints: { type: "integer", minimum: 0 },
    maxPointsForCampaign: { type: "integer", minimum: 0 },
  },
  required: [
    "allocationId",
    "rewardPointsPerCompletion",
    "accuracyBonusPoints",
    "maxPointsForCampaign",
  ],
  additionalProperties: false,
};

export const STUDIO_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  // --- campaign-draft.controller.ts ---
  {
    method: "post",
    path: "/api/{tenantId}/studio/campaigns",
    summary: "Create a campaign draft",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM],
    requestBody: {
      description: "The campaign's shape and targeting; media, reward and questions come later.",
      schema: createCampaignDraftRequestBodySchema,
    },
    successStatus: 201,
    successDescription: 'The new draft, in lifecycleState "draft".',
    successSchema: campaignDraftResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, CAMPAIGN_AUTHORING_400, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/campaigns",
    summary: "List this business's campaign drafts",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every campaign this business owns, at any lifecycle state.",
    successSchema: { type: "array", items: campaignDraftResponseSchema },
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}",
    summary: "Get one campaign draft",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    successStatus: 200,
    successDescription: "The campaign, in its authoring shape.",
    successSchema: campaignDraftResponseSchema,
    errors: [FORBIDDEN, STUDIO_CAMPAIGN_NOT_FOUND, SERVICE_UNAVAILABLE],
  },
  {
    method: "patch",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}",
    summary: "Patch a campaign draft",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    requestBody: {
      description:
        "Any subset of fields; chapters/declaredInterests, when present, replace the whole set.",
      schema: updateCampaignDraftRequestBodySchema,
    },
    successStatus: 200,
    successDescription: "The patched draft.",
    successSchema: campaignDraftResponseSchema,
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      STUDIO_CAMPAIGN_NOT_FOUND,
      CAMPAIGN_NOT_DRAFT,
      CAMPAIGN_AUTHORING_400,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/submit",
    summary: "Submit a campaign draft for review",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    // Nest's default POST status -- campaign-draft.controller.ts's `submit`
    // carries no @HttpCode override, verified against the real 7.3.e Check.
    successStatus: 201,
    successDescription:
      'The campaign, now in lifecycleState "in_review" (or later -- see illegal_transition below for a repeat call).',
    successSchema: campaignDraftResponseSchema,
    errors: [
      FORBIDDEN,
      STUDIO_CAMPAIGN_NOT_FOUND,
      NOT_KYB_VERIFIED,
      ILLEGAL_TRANSITION,
      SERVICE_UNAVAILABLE,
    ],
  },

  // --- question-bank.controller.ts ---
  {
    method: "get",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/questions",
    summary: "List a campaign's question bank",
    tags: ["studio", "question"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    successStatus: 200,
    successDescription: "Every question authored for this campaign, at any status.",
    successSchema: { type: "array", items: bankQuestionResponseSchema },
    errors: [FORBIDDEN, SERVICE_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/questions",
    summary: "Author a question",
    tags: ["studio", "question"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    requestBody: {
      description:
        "One of the five question types (questionSchema's discriminated union); id/campaignId " +
        "are accepted for the union's shape but ignored -- the server assigns the real id and " +
        "the route's own :campaignId is authoritative.",
      schema: inlineSchema(questionSchema),
    },
    successStatus: 201,
    successDescription:
      "The authored question, screened for PII/prediction requests before being stored.",
    successSchema: bankQuestionResponseSchema,
    errors: [VALIDATION_400, FORBIDDEN, QUESTION_GUARD_400, SERVICE_UNAVAILABLE],
  },
  {
    method: "patch",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/questions/{questionId}",
    summary: "Edit a question",
    tags: ["studio", "question"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM, QUESTION_ID_PARAM],
    requestBody: {
      description:
        "The full question again (same shape as create) -- `type` must match the stored " +
        "question's own type; a type change is refused (question_type_immutable). Status " +
        "resets to draft and the PII/prediction guards re-run. Refused once the campaign has " +
        "left draft, same as any other draft CRUD in this module.",
      schema: inlineSchema(questionSchema),
    },
    successStatus: 200,
    successDescription: "The edited question, re-screened and reset to status draft.",
    successSchema: bankQuestionResponseSchema,
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      QUESTION_NOT_FOUND,
      QUESTION_TYPE_IMMUTABLE,
      STUDIO_CAMPAIGN_NOT_FOUND,
      CAMPAIGN_NOT_DRAFT,
      QUESTION_GUARD_400,
      SERVICE_UNAVAILABLE,
    ],
  },
  {
    method: "delete",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/questions/{questionId}",
    summary: "Retire (withdraw) a question",
    tags: ["studio", "question"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM, QUESTION_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The now-retired question -- a soft-retire (questionStatusSchema's `retired`), never a " +
      "row delete; refused once the campaign has left draft.",
    successSchema: bankQuestionResponseSchema,
    errors: [
      FORBIDDEN,
      QUESTION_NOT_FOUND,
      STUDIO_CAMPAIGN_NOT_FOUND,
      CAMPAIGN_NOT_DRAFT,
      SERVICE_UNAVAILABLE,
    ],
  },

  // --- reward-config.controller.ts ---
  {
    method: "put",
    path: "/api/{tenantId}/studio/campaigns/{campaignId}/reward",
    summary: "Set a campaign's reward and budget configuration",
    tags: ["studio", "campaign"],
    pathParams: [TENANT_ID_PARAM, CAMPAIGN_ID_PARAM],
    requestBody: {
      description:
        "A full replacement, not a delta -- funderType/the allocation's balance are validated " +
        "server-side against the ledger, never trusted from the request.",
      schema: setRewardConfigRequestBodySchema,
    },
    successStatus: 200,
    successDescription:
      "The draft, plus the reward's value in the business's own currency (7.3.h) -- never B, the backing rate.",
    successSchema: setRewardConfigResponseSchema,
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      STUDIO_CAMPAIGN_NOT_FOUND,
      CAMPAIGN_NOT_DRAFT,
      REWARD_CONFIG_400,
      SERVICE_UNAVAILABLE,
    ],
  },
];

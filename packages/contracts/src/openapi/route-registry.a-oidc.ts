import {
  interactionCancelRequestSchema,
  interactionContinueRequestSchema,
  interactionDetailsSchema,
  interactionRedirectSchema,
} from "../oidc/interaction";
import {
  teenInviteCreatedSchema,
  teenInviteParentRequestSchema,
  teenInviteSchema,
} from "../oidc/teen-invite";
import {
  transferAssertionRequestSchema,
  transferAssertionSchema,
  transferCreateRequestSchema,
  transferCreatedSchema,
} from "../oidc/transfer";
import {
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * Group 3.9 (docs/26 §1.1): the interaction API behind YourTal's `/connect/[uid]`
 * screens. Authenticated by the provider's interaction cookie and the YourTal
 * session the web server forwards, not by Cerbos. The provider's own routes
 * under `/oidc` are protocol routes (`oidc/protocol-routes.ts`), not listed here.
 */
const UID: RoutePathParam = {
  name: "uid",
  description: "The sign-in's interaction id, from the /connect/{uid} page address.",
  schema: { type: "string", minLength: 1 },
};

const NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No sign-in in progress for this browser: the interaction cookie is missing, does not match the uid, " +
    "or has expired (interaction_not_found). Also when sign-in with YourTal is switched off.",
  documented: true,
};
const ORIGIN_REFUSED: RouteErrorResponse = {
  status: 403,
  description:
    "A POST that did not come from YourTal's own web server (cross-site Origin or Sec-Fetch-Site) " +
    "(origin_refused), or a sign-in YourTal refuses (sign_in_refused, with the refusal code).",
  documented: true,
};
const SESSION_REQUIRED: RouteErrorResponse = {
  status: 401,
  description: "Continue needs a signed-in YourTal session (session_required).",
  documented: true,
};
const SCREEN_CHANGED: RouteErrorResponse = {
  status: 409,
  description:
    "What the person must see has changed since the page loaded, e.g. consent is now needed or the " +
    "email is not verified (screen_changed). Reload the details.",
  documented: true,
};
const UNSUPPORTED_MEDIA: RouteErrorResponse = {
  status: 415,
  description: "The body must be application/json (unsupported_media_type).",
  documented: true,
};

export const OIDC_INTERACTION_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/connect/{uid}",
    summary: "What the sign-in screen for this app shows now",
    tags: ["oidc"],
    pathParams: [UID],
    successStatus: 200,
    successDescription: "The app, the screen to show, and the signed-in account if there is one.",
    successSchema: inlineSchema(interactionDetailsSchema),
    errors: [NOT_FOUND],
  },
  {
    method: "post",
    path: "/api/connect/{uid}/continue",
    summary: "Finish signing in to the app as the current YourTal account",
    tags: ["oidc"],
    pathParams: [UID],
    requestBody: {
      description: "The screen the person tapped Continue on.",
      schema: inlineSchema(interactionContinueRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "Where the browser goes next. The provider then returns to the app with a code.",
    successSchema: inlineSchema(interactionRedirectSchema),
    errors: [
      VALIDATION_400,
      SESSION_REQUIRED,
      ORIGIN_REFUSED,
      NOT_FOUND,
      SCREEN_CHANGED,
      UNSUPPORTED_MEDIA,
    ],
  },
  {
    method: "post",
    path: "/api/connect/{uid}/cancel",
    summary: "Go back to the app without signing in",
    tags: ["oidc"],
    pathParams: [UID],
    requestBody: {
      description: "An empty object.",
      schema: inlineSchema(interactionCancelRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "Where the browser goes next. The app gets error=access_denied with the refusal code, or " +
      "user_cancelled, as error_description.",
    successSchema: inlineSchema(interactionRedirectSchema),
    errors: [VALIDATION_400, ORIGIN_REFUSED, NOT_FOUND, UNSUPPORTED_MEDIA],
  },
];

/**
 * Group 3.9.e (docs/26 §3.3): the teen invite API, for SnapApp's server. A
 * client-credentials access token with scope `teen_invites`
 * (`Authorization: Bearer …`), checked by a guard before anything else; not Cerbos.
 */
const INVITE_ID: RoutePathParam = {
  name: "inviteId",
  description: "An invite this app made.",
  schema: { type: "string", format: "uuid" },
};
const INVALID_TOKEN: RouteErrorResponse = {
  status: 401,
  description:
    "No valid client-credentials access token from a registered machine client (invalid_token).",
  documented: true,
};
const INSUFFICIENT_SCOPE: RouteErrorResponse = {
  status: 403,
  description: "The token lacks the teen_invites scope (insufficient_scope).",
  documented: true,
};
const INVITE_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description:
    "No such invite in this app, or (on end) not one this parent made (invite_not_found). " +
    "Also when sign in with YourTal is switched off.",
  documented: true,
};
const IDEMPOTENCY_KEY_400: RouteErrorResponse = {
  status: 400,
  description: "The Idempotency-Key header is missing (idempotency_key_required).",
  documented: true,
};
const IDEMPOTENCY_409: RouteErrorResponse = {
  status: 409,
  description:
    "The Idempotency-Key was used with another body, or its first request is still running.",
  documented: true,
};

export const OIDC_TEEN_INVITE_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/oidc-clients/teen-invites",
    summary: "Make a one-time invite for a parent's teen to join the app",
    tags: ["oidc"],
    pathParams: [],
    requestBody: {
      description:
        "The parent's sub in this app. Takes an Idempotency-Key; a parent may make 10 a day.",
      schema: inlineSchema(teenInviteParentRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The invite and its one-time code for the join link (valid 7 days). A replay of the same " +
      "Idempotency-Key answers without the code, which YourTal keeps only as a hash.",
    successSchema: inlineSchema(teenInviteCreatedSchema),
    errors: [
      VALIDATION_400,
      IDEMPOTENCY_KEY_400,
      INVALID_TOKEN,
      {
        status: 403,
        description:
          "The token lacks the teen_invites scope (insufficient_scope), or the parent is not a " +
          "verified adult with YourTal (parent_not_eligible).",
        documented: true,
      },
      IDEMPOTENCY_409,
      {
        status: 429,
        description: "This parent has made 10 invites in the last day (too_many_invites).",
        documented: true,
      },
    ],
  },
  {
    method: "get",
    path: "/api/oidc-clients/teen-invites/{inviteId}",
    summary: "Read an invite: whether a teen accepted it, and as whom",
    tags: ["oidc"],
    pathParams: [INVITE_ID],
    successStatus: 200,
    successDescription:
      "pending, accepted, expired or ended, with the teen's sub in this app once accepted.",
    successSchema: inlineSchema(teenInviteSchema),
    errors: [INVALID_TOKEN, INSUFFICIENT_SCOPE, INVITE_NOT_FOUND],
  },
  {
    method: "post",
    path: "/api/oidc-clients/teen-invites/{inviteId}/end",
    summary: "End the invite and the teen's access to the app",
    tags: ["oidc"],
    pathParams: [INVITE_ID],
    requestBody: {
      description: "The inviting parent's sub in this app. Takes an Idempotency-Key.",
      schema: inlineSchema(teenInviteParentRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "The invite, now ended. When a teen had accepted it, their consent ends and the app is " +
      "sent access-ended with reason parent_ended and erase_data true. Ending it again answers the same.",
    successSchema: inlineSchema(teenInviteSchema),
    errors: [
      VALIDATION_400,
      IDEMPOTENCY_KEY_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      INVITE_NOT_FOUND,
      IDEMPOTENCY_409,
    ],
  },
];

/**
 * Group 4.8.a (docs/30 §5): the transfer API, for SnapApp's server. A
 * client-credentials access token with scope `app_transfers`, checked by a guard
 * first; not Cerbos. Never says whether the person uses the destination.
 */
const TRANSFER_ID: RoutePathParam = {
  name: "transferId",
  description: "A transfer this app opened.",
  schema: { type: "string", format: "uuid" },
};
const TRANSFER_SCOPE_403: RouteErrorResponse = {
  status: 403,
  description: "The token lacks the app_transfers scope (insufficient_scope).",
  documented: true,
};

export const OIDC_TRANSFER_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/oidc-clients/transfers",
    summary: "Open a transfer of one person's data to another app, for them to confirm",
    tags: ["oidc"],
    pathParams: [],
    requestBody: {
      description:
        "The person's sub in this app, the destination, the year, the bundle's SHA-256 and line " +
        "count. Takes an Idempotency-Key.",
      schema: inlineSchema(transferCreateRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The transfer, live for 15 minutes. Send the person to YourTal with transfer={transferId}.",
    successSchema: inlineSchema(transferCreatedSchema),
    errors: [
      VALIDATION_400,
      IDEMPOTENCY_KEY_400,
      INVALID_TOKEN,
      TRANSFER_SCOPE_403,
      {
        status: 404,
        description:
          "No such person in this app (unknown_subject), no route from this app to the " +
          "destination here (no_route), or sign in with YourTal is switched off.",
        documented: true,
      },
      IDEMPOTENCY_409,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/transfers/{transferId}/assertion",
    summary: "Fetch the assertion for a transfer the person has sent",
    tags: ["oidc"],
    pathParams: [TRANSFER_ID],
    requestBody: {
      description: "The person's sub in this app.",
      schema: inlineSchema(transferAssertionRequestSchema),
    },
    successStatus: 200,
    successDescription:
      "A compact JWE only the destination can open, with Cache-Control no-store. Pass it on; " +
      "never decode, log or keep it.",
    successSchema: inlineSchema(transferAssertionSchema),
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      TRANSFER_SCOPE_403,
      {
        status: 404,
        description:
          "No such live transfer from this app, or the sub is not its person (transfer_not_found).",
        documented: true,
      },
      {
        status: 409,
        description:
          "The person has not sent it yet (not_approved), or it can no longer be sent " +
          "(not_allowed: not an adult in a route region, on hold, or the destination's access ended).",
        documented: true,
      },
    ],
  },
];

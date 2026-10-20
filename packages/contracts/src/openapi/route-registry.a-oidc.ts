import {
  interactionCancelRequestSchema,
  interactionContinueRequestSchema,
  interactionDetailsSchema,
  interactionRedirectSchema,
} from "../oidc/interaction";
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

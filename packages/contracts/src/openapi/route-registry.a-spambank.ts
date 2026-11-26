import { mailSessionSchema } from "../spambank/common";
import {
  appPasswordCreatedSchema,
  appPasswordListSchema,
  createAppPasswordRequestSchema,
  enableMailboxResultSchema,
  machineCreateAppPasswordRequestSchema,
  machineMailboxStatusSchema,
  machineRevokeAppPasswordRequestSchema,
  machineSettingsRequestSchema,
  machineSubRequestSchema,
  mailboxStatusSchema,
} from "../spambank/management";
import {
  FORBIDDEN,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
} from "./route-registry-shared";

/**
 * Spambank's management API (spambank/BUILD.md §5.1, §5.2). The mail itself is the proxy's (T5).
 * Errors are `{ code, message }`.
 */

const APP_PASSWORD_ID: RoutePathParam = {
  name: "id",
  description: "An app password of this mailbox, from the list.",
  schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
};

const NOT_ENABLED: RouteErrorResponse = {
  status: 409,
  description: "The person has no mailbox yet (not_enabled); switch it on first.",
  documented: true,
};
const UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "The mail server could not be reached or is not configured (spambank_unavailable). The mailbox " +
    "is not lost: a repeat finishes the work.",
  documented: true,
};
const SWITCHED_OFF: RouteErrorResponse = {
  status: 404,
  description: "Spambank is switched off for YourTal's own screens (not_found).",
  documented: true,
};

/** The session routes: a YourTal session, adults only, decided by Cerbos (`spambank`). */
export const SPAMBANK_ME_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/spambank/me",
    summary: "The signed-in person's mailbox: off, on, suspended or not allowed",
    tags: ["spambank"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "available is false when Spambank is switched off. Otherwise the state, and for a mailbox its " +
      "address, creation time and quota (the quota is left out when the mail server cannot be asked).",
    successSchema: inlineSchema(mailboxStatusSchema),
    errors: [FORBIDDEN],
  },
  {
    method: "post",
    path: "/api/spambank/me/enable",
    summary: "Switch the mailbox on: pick a name, create the account, set up its folders",
    tags: ["spambank"],
    pathParams: [],
    successStatus: 201,
    successDescription:
      "201 for a new mailbox, 200 for the one the person already has (same address). The name is final.",
    successSchema: inlineSchema(enableMailboxResultSchema),
    errors: [
      FORBIDDEN,
      SWITCHED_OFF,
      {
        status: 409,
        description: "The mailbox is being deleted (mailbox_erasing); try again in a few minutes.",
        documented: true,
      },
      UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/spambank/me/session",
    summary: "A 30-minute mail token for the proxy, for the person's own mailbox",
    tags: ["spambank"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "The token, when it expires, where the JMAP session and the helper routes are, and the address.",
    successSchema: inlineSchema(mailSessionSchema),
    errors: [
      FORBIDDEN,
      SWITCHED_OFF,
      NOT_ENABLED,
      { status: 403, description: "The mailbox is suspended (not_allowed).", documented: true },
      UNAVAILABLE,
    ],
  },
  {
    method: "get",
    path: "/api/spambank/me/app-passwords",
    summary: "The app passwords for the phone's mail app: names and dates, never the secret",
    tags: ["spambank"],
    pathParams: [],
    successStatus: 200,
    successDescription: "At most five.",
    successSchema: inlineSchema(appPasswordListSchema),
    errors: [FORBIDDEN, SWITCHED_OFF, NOT_ENABLED, UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/spambank/me/app-passwords",
    summary: "Make an app password, with the settings for the phone's mail app",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "A name of 1-40 characters, such as the phone it is for.",
      schema: inlineSchema(createAppPasswordRequestSchema),
    },
    successStatus: 201,
    successDescription:
      "The secret is shown once and never again, with IMAP mail.yourtal.gaiada.com:993 (SSL/TLS), " +
      "SMTP :465 (SSL/TLS) and the address as the username.",
    successSchema: inlineSchema(appPasswordCreatedSchema),
    errors: [
      VALIDATION_400,
      FORBIDDEN,
      SWITCHED_OFF,
      NOT_ENABLED,
      {
        status: 409,
        description: "Five app passwords already exist (app_password_limit); revoke one first.",
        documented: true,
      },
      UNAVAILABLE,
    ],
  },
  {
    method: "delete",
    path: "/api/spambank/me/app-passwords/{id}",
    summary: "Revoke an app password; the phone's mail app stops signing in",
    tags: ["spambank"],
    pathParams: [APP_PASSWORD_ID],
    successStatus: 204,
    successDescription: "Revoked, or it was already gone.",
    successSchema: { type: "null" },
    errors: [FORBIDDEN, SWITCHED_OFF, NOT_ENABLED, UNAVAILABLE],
  },
  {
    method: "delete",
    path: "/api/spambank/me",
    summary: "Delete the mailbox only: the account stays, the address is retired for good",
    tags: ["spambank"],
    pathParams: [],
    successStatus: 202,
    successDescription:
      "Accepted: the mail account is destroyed within minutes and the name is never given out again.",
    successSchema: { type: "null" },
    errors: [FORBIDDEN, SWITCHED_OFF, NOT_ENABLED],
  },
];

const INVALID_TOKEN: RouteErrorResponse = {
  status: 401,
  description:
    "No valid client-credentials access token from a registered machine client (invalid_token).",
  documented: true,
};
const INSUFFICIENT_SCOPE: RouteErrorResponse = {
  status: 403,
  description:
    "The token lacks the spambank scope (insufficient_scope), or the person may not use Spambank " +
    "(not_allowed: a teen, on hold, outside the app's regions, or the app's consent ended), or the " +
    "route is SnapApp's only (not_allowed).",
  documented: true,
};
const UNKNOWN_SUBJECT: RouteErrorResponse = {
  status: 404,
  description:
    "No such person in this app (unknown_subject), or sign in with YourTal is switched off.",
  documented: true,
};

/**
 * The machine routes, for each app's server: a client-credentials token with scope `spambank`. The
 * person is always the calling app's own pairwise `sub`.
 */
export const SPAMBANK_MACHINE_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/oidc-clients/spambank/status",
    summary: "The person's mailbox, as the app should show it",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub in this app.",
      schema: inlineSchema(machineSubRequestSchema),
    },
    successStatus: 200,
    successDescription: "As the session route, plus the settings an app may read.",
    successSchema: inlineSchema(machineMailboxStatusSchema),
    errors: [VALIDATION_400, INVALID_TOKEN, INSUFFICIENT_SCOPE, UNKNOWN_SUBJECT],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/enable",
    summary: "Switch the person's mailbox on from an app",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub in this app.",
      schema: inlineSchema(machineSubRequestSchema),
    },
    successStatus: 201,
    successDescription: "201 for a new mailbox, 200 for the one the person already has.",
    successSchema: inlineSchema(enableMailboxResultSchema),
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      {
        status: 409,
        description: "The mailbox is being deleted (mailbox_erasing); try again in a few minutes.",
        documented: true,
      },
      UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/session",
    summary: "A 30-minute mail token for the person's mailbox, named for the calling app",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub in this app.",
      schema: inlineSchema(machineSubRequestSchema),
    },
    successStatus: 200,
    successDescription: "Give it to the app's own client; the proxy takes it as a bearer token.",
    successSchema: inlineSchema(mailSessionSchema),
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      NOT_ENABLED,
      UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/settings",
    summary: "Change the mailbox settings SnapApp owns",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description:
        "The person's sub and at least one of statementsToSnapApp and newMailAlerts. SnapApp only.",
      schema: inlineSchema(machineSettingsRequestSchema),
    },
    successStatus: 200,
    successDescription: "The status after the change.",
    successSchema: inlineSchema(machineMailboxStatusSchema),
    errors: [
      { ...VALIDATION_400, description: `${VALIDATION_400.description} Also no setting given.` },
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      NOT_ENABLED,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/app-passwords/list",
    summary: "The person's app passwords",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub in this app.",
      schema: inlineSchema(machineSubRequestSchema),
    },
    successStatus: 200,
    successDescription: "Names and dates, never a secret.",
    successSchema: inlineSchema(appPasswordListSchema),
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      NOT_ENABLED,
      UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/app-passwords",
    summary: "Make an app password for the person",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub and a name of 1-40 characters.",
      schema: inlineSchema(machineCreateAppPasswordRequestSchema),
    },
    successStatus: 201,
    successDescription: "As the session route: the secret is shown once.",
    successSchema: inlineSchema(appPasswordCreatedSchema),
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      NOT_ENABLED,
      {
        status: 409,
        description: "Five app passwords already exist (app_password_limit).",
        documented: true,
      },
      UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/app-passwords/revoke",
    summary: "Revoke one of the person's app passwords",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub and the app password id.",
      schema: inlineSchema(machineRevokeAppPasswordRequestSchema),
    },
    successStatus: 204,
    successDescription: "Revoked, or it was already gone.",
    successSchema: { type: "null" },
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      INSUFFICIENT_SCOPE,
      UNKNOWN_SUBJECT,
      NOT_ENABLED,
      UNAVAILABLE,
    ],
  },
];

import { attachmentFetchRequestSchema, statementAckRequestSchema } from "../spambank/events";
import {
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
} from "./route-registry-shared";

/**
 * Spambank's inbound pipeline (spambank/BUILD.md §5.2, §5.4): Stalwart's webhook, and the two machine
 * routes SnapApp's server uses to bring a mailed statement in. Errors are `{ code, message }`.
 */

const INVALID_TOKEN: RouteErrorResponse = {
  status: 401,
  description:
    "No valid client-credentials access token from a registered machine client (invalid_token).",
  documented: true,
};
const SCOPE_OR_APP_403: RouteErrorResponse = {
  status: 403,
  description:
    "The token lacks the spambank scope (insufficient_scope), the client is not SnapApp's (not_allowed), " +
    "or the person ended their access to the app or the mailbox is suspended (not_allowed).",
  documented: true,
};
const NOT_ENABLED_409: RouteErrorResponse = {
  status: 409,
  description: "The person has no mailbox yet (not_enabled).",
  documented: true,
};

export const SPAMBANK_INGEST_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "post",
    path: "/api/spambank/hooks/stalwart",
    summary: "Stalwart's webhook: mail was delivered, read it now",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description:
        "Stalwart's own JSON (events with a type and data). Read defensively: a shape nobody " +
        "understands only delays the mail by the one-minute reconcile. Signed with an X-Signature " +
        "HMAC-SHA256 of the raw body; at most 64 KB.",
      schema: { type: "object", additionalProperties: true },
    },
    successStatus: 202,
    successDescription:
      "Accepted. Always 202 once the signature is good, whatever the payload says.",
    successSchema: {
      type: "object",
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      additionalProperties: false,
    },
    errors: [
      {
        status: 401,
        description:
          "The X-Signature is missing or wrong, or no webhook secret is set (unauthorized).",
        documented: true,
      },
      {
        status: 413,
        description: "The body is over 64 KB (too_large).",
        documented: true,
      },
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/attachments/fetch",
    summary: "Fetch the bytes of one mailed statement that was offered to this app",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description: "The person's sub in this app, and the offered message and file ids.",
      schema: inlineSchema(attachmentFetchRequestSchema),
    },
    successStatus: 200,
    successContentType: "application/octet-stream",
    successDescription:
      "The file, with the Content-Type of the part, Content-Disposition attachment, nosniff and " +
      "Cache-Control no-store. SnapApp only.",
    successSchema: { type: "string", format: "binary" },
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      SCOPE_OR_APP_403,
      {
        status: 404,
        description:
          "No such person (unknown_subject), or this person was never offered that file, or the " +
          "mail server no longer has it (not_found).",
        documented: true,
      },
      NOT_ENABLED_409,
      {
        status: 502,
        description: "The mail server refused our login or the file (upstream_auth).",
        documented: true,
      },
      {
        status: 503,
        description: "The mail server could not be reached (spambank_unavailable); try again.",
        documented: true,
      },
    ],
  },
  {
    method: "post",
    path: "/api/oidc-clients/spambank/statements/ack",
    summary: "Report what SnapApp did with an offered statement",
    tags: ["spambank"],
    pathParams: [],
    requestBody: {
      description:
        "The person's sub, the offered message and file ids, and imported, duplicate, failed or skipped.",
      schema: inlineSchema(statementAckRequestSchema),
    },
    successStatus: 204,
    successDescription: "Recorded. The same outcome twice is the same row.",
    successSchema: { type: "null" },
    errors: [
      VALIDATION_400,
      INVALID_TOKEN,
      SCOPE_OR_APP_403,
      {
        status: 404,
        description: "No such person (unknown_subject), or no such offer for them (not_found).",
        documented: true,
      },
      NOT_ENABLED_409,
    ],
  },
];

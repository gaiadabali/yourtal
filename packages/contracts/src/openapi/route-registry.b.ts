import { z } from "zod";
import {
  FORBIDDEN,
  PDP_UNAVAILABLE,
  arrayOf,
  inlineSchema,
  nestDefaultError,
  ref,
  NEST_DEFAULT_ERROR_SCHEMA,
  type RouteDefinition,
  type RoutePathParam,
  type RouteQueryParam,
} from "./route-registry-shared";

/**
 * Area B's routes (viewer app — `apps/api/src/modules/{watch,campaign,me}/**`,
 * per TASKS.md's "Areas and ownership"). 1.3.a split this out of the old
 * single `route-registry.ts` so Area B can add its own routes here without
 * touching Area A's or Area C's files. See `route-registry-shared.ts` for the
 * common types and OpenAPI-assembly helpers, and `route-registry.ts` for how
 * this file's routes are concatenated with the other areas'.
 *
 * Neither campaign.controller.ts nor watch.controller.ts has a
 * to-http-exception.ts-style domain-error mapper. Every domain-level refusal
 * in those two files is a bare `throw new XException("a string")`, which is
 * Nest's OWN default body — statusCode, message, error — not this API's
 * {code,message} ErrorResponse envelope. See NEST_DEFAULT_ERROR_SCHEMA and
 * nestDefaultError() in route-registry-shared.ts for the shape and the
 * citation. Both controllers are `@Authorize`d, so the SAME status can arrive
 * two different ways: a PDP denial (ErrorResponse, via authz-error.mapper.ts)
 * or a domain refusal thrown directly (NEST_DEFAULT_ERROR_SCHEMA). Where a
 * route can produce both under one status, that status gets exactly one
 * hand-written RouteErrorResponse with an `anyOf` of both shapes — never two
 * separate entries, which the fold in route-registry-shared.ts's
 * operationObject() cannot merge correctly.
 *
 * `checkpoint.controller.ts`, in the watch module directory, is NOT here — it
 * stays in `route-drift.test.ts`'s `KNOWN_OUT_OF_SCOPE` ledger under its own
 * YT-0121/YT-0122 entry.
 */

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

const CHANNEL_HANDLE_PARAM: RoutePathParam = {
  name: "handle",
  description: "The business's own handle (business.business_accounts.handle).",
  schema: { type: "string" },
};

const CHANNEL_BUSINESS_ID_PARAM: RoutePathParam = {
  name: "businessId",
  description: "The business whose channel page is being read.",
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
  {
    // Found blocking 10.6's own release (route-drift.test.ts): 11.5.a added
    // this route without a registry entry. Fixed here rather than left for
    // Area B, since it was failing `pnpm check` for every push to main.
    method: "get",
    path: "/api/campaigns/{campaignId}/terms",
    summary:
      "The campaign's currently-in-force terms (11.5.a) -- absolute reward points, question count and duration",
    tags: ["campaign"],
    pathParams: [CAMPAIGN_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The same frozen numbers a watch session would enter under, so the campaign page's terms " +
      "card shows absolute points rather than re-deriving them from a ratio.",
    successSchema: ref("CampaignTerms"),
    errors: [
      nestDefaultError(
        404,
        "No such campaign (the same answer for a missing id or an unpublished draft), or this " +
          "campaign has no published terms yet.",
      ),
      FORBIDDEN,
      PDP_UNAVAILABLE,
    ],
  },
];

// --- channel.controller.ts (11.5.d) ---

const CHANNEL_NOT_FOUND = nestDefaultError(
  404,
  "No such channel -- a bad handle/id, or a suspended business, are the same 404.",
);

export const CHANNEL_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/channels/{handle}",
    summary: "Read a business's own channel page by handle",
    tags: ["channel"],
    pathParams: [CHANNEL_HANDLE_PARAM],
    successStatus: 200,
    successDescription:
      "The channel's summary, its still-live campaigns and its own store listings.",
    successSchema: ref("ChannelReadResponse"),
    errors: [CHANNEL_NOT_FOUND, FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/channels/by-business/{businessId}",
    summary: "Read a business's own channel page by businessId",
    tags: ["channel"],
    pathParams: [CHANNEL_BUSINESS_ID_PARAM],
    successStatus: 200,
    successDescription:
      "Same shape as GET /api/channels/{handle} -- for a caller (the watch page's channel row) that only has a businessId.",
    successSchema: ref("ChannelReadResponse"),
    errors: [CHANNEL_NOT_FOUND, FORBIDDEN, PDP_UNAVAILABLE],
  },
];

// --- watch.controller.ts ---

const startWatchSessionRequestSchema = inlineSchema(z.object({ campaignId: z.uuid() }));

const startWatchSessionResponseSchema: Record<string, unknown> = {
  type: "object",
  description:
    "The session — reactivated if one was already open for this exact (user, campaign, terms " +
    "version) tuple, parking whatever else was active, otherwise freshly created (5.1.b) — plus " +
    "the campaign's duration, `alreadyEarned` (true when this user has already been granted this " +
    "campaign's reward and the session is a non-earning replay), and a per-session manifest URL " +
    "(5.1.d; unsigned until @yourtal/media exports mintSegmentUrl, 7.2.c).",
  properties: {
    session: ref("WatchSession"),
    durationSeconds: { type: "integer", minimum: 1 },
    alreadyEarned: { type: "boolean" },
    manifestUrl: { type: "string" },
  },
  required: ["session", "durationSeconds", "alreadyEarned", "manifestUrl"],
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
  description:
    "`completed` is always true on success — a refusal throws instead (see the 403 below). " +
    "`granted` is false with `reason` set (never `pendingPoints`/`unlockAt`) when the session was " +
    "non-earning (already_earned, no funding configured, the allocation hold failed, or the grant " +
    "call itself failed after coverage completed) — 5.1.b/5.3.a. `deliveryCoverage` is the 10.4.c " +
    'segment-log cross-check\'s verdict, `"unknown"` until that lands (5.1.d).',
  properties: {
    completed: { const: true },
    granted: { type: "boolean" },
    pendingPoints: { type: "integer", minimum: 0 },
    unlockAt: { type: "string", format: "date-time" },
    reason: { type: "string" },
    deliveryCoverage: { type: "string", enum: ["matches", "gap_detected", "unknown"] },
  },
  required: ["completed", "granted", "pendingPoints"],
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
          "(apps/api/src/main.ts) never runs for it, so VALIDATION_400 does not apply here.",
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
    path: "/api/watch/sessions",
    summary: "List the caller's unfinished watch sessions (Continue watching)",
    tags: ["watch"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "Active sessions on campaigns still in the catalogue, most recently watched first, at most 20.",
    successSchema: ref("ContinueWatchingResponse"),
    errors: [FORBIDDEN, PDP_UNAVAILABLE],
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
          "not `active` (superseded/completed/void), or its campaign is no longer live " +
          "(EW-19) — is thrown directly by watch.controller.ts and returns Nest's own body " +
          "instead.",
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
      "The session earned its reward under decision O-1 (full coverage and every checkpoint " +
      "answered) — 5.3. `grantReward` is called only when the session is earning; a non-earning " +
      "session (already_earned, unfunded, or a failed hold/grant) still completes but never pays.",
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
      nestDefaultError(
        409,
        "EW-10: `markCompleted`'s conditional update lost a race against another concurrent " +
          "completion of the SAME session (a distinct Idempotency-Key from whichever request won) " +
          "— that other request is the only one that may have granted. Never a second grant from here.",
      ),
      PDP_UNAVAILABLE,
    ],
  },
  {
    // 11.2.b: Open Viewing's anonymous, non-earning session —
    // `open-view-session.controller.ts`, deliberately its own controller,
    // never `WatchController`.
    method: "post",
    path: "/api/watch/open-view-sessions",
    summary: "Start (or resume) an anonymous Open Viewing session",
    tags: ["watch"],
    pathParams: [],
    requestBody: {
      description: "The campaign to watch anonymously.",
      schema: inlineSchema(z.object({ campaignId: z.uuid() })),
    },
    successStatus: 201,
    successDescription:
      "A per-session signed manifest URL (the same scheme as POST /api/watch/sessions), never " +
      "the raw /media/hls/ path. No ledger hold, no watch.session row — this session can never " +
      "earn.",
    successSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        durationSeconds: { type: "integer", minimum: 1 },
        manifestUrl: { type: "string" },
      },
      required: ["sessionId", "durationSeconds", "manifestUrl"],
      additionalProperties: false,
    },
    errors: [
      nestDefaultError(400, "The body is missing campaignId, or it is not a UUID."),
      nestDefaultError(404, "No such campaign."),
      {
        status: 403,
        description:
          "One of: the PDP denies `watch_open` for this campaign (not live, not opted into Open " +
          "Viewing, or its Open Viewing budget is exhausted — ErrorResponse); this campaign is not " +
          "all_ages (defence in depth, thrown directly, Nest's own body); this IP has spent " +
          "today's F12 Open Viewing minute cap; or this IP already has an anonymous session open " +
          "on a different campaign (F12's one-concurrent-session rule).",
        documented: true,
        schema: { anyOf: [ref("ErrorResponse"), NEST_DEFAULT_ERROR_SCHEMA] },
      },
      PDP_UNAVAILABLE,
    ],
  },
  {
    method: "post",
    path: "/api/watch/open-view-sessions/{openViewSessionId}/progress",
    summary: "Report a span of anonymous playback",
    tags: ["watch"],
    pathParams: [
      {
        name: "openViewSessionId",
        description: "The anonymous session being progressed.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      description:
        "campaignId (so the PDP has one to check, same shape as the start route) plus the span " +
        "played, in the client's own playback-position seconds.",
      schema: inlineSchema(
        z.object({
          campaignId: z.uuid(),
          fromSeconds: z.number().min(0),
          toSeconds: z.number().min(0),
        }),
      ),
    },
    successStatus: 201,
    successDescription: "The report was merged into this session's running total.",
    successSchema: {
      type: "object",
      properties: { accepted: { const: true }, watchedSeconds: { type: "integer", minimum: 0 } },
      required: ["accepted", "watchedSeconds"],
      additionalProperties: false,
    },
    errors: [
      nestDefaultError(400, "The body is missing campaignId/fromSeconds/toSeconds."),
      nestDefaultError(
        404,
        "No such open-view session for this caller's IP, or its campaignId does not match the body's.",
      ),
      FORBIDDEN,
      PDP_UNAVAILABLE,
    ],
  },
];

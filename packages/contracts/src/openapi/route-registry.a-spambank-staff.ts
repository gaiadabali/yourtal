import {
  LEAD_EXPORT_MAX,
  LEAD_PAGE_SIZE,
  LEAD_STATUSES,
  spambankAutoreplyChangeSchema,
  spambankAutoreplySchema,
  spambankLeadPageSchema,
  spambankLeadSchema,
  spambankLeadUpdateSchema,
} from "../spambank/staff";
import {
  FORBIDDEN,
  PDP_UNAVAILABLE,
  VALIDATION_400,
  inlineSchema,
  type RouteDefinition,
  type RouteErrorResponse,
  type RoutePathParam,
  type RouteQueryParam,
} from "./route-registry-shared";

/**
 * Spambank's staff API (spambank/BUILD.md 5.4), `apps/api/src/modules/spambank/staff/`: the leads list
 * and the auto-reply panel. The region of the leads routes is the signed-in staff member's own, never a
 * parameter. Errors are `{ code, message }`.
 */

const LEAD_FILTERS: readonly RouteQueryParam[] = [
  {
    name: "status",
    description: "Only leads with this status.",
    required: false,
    schema: { type: "string", enum: [...LEAD_STATUSES] },
  },
  {
    name: "q",
    description:
      "Case-insensitive text in the brand's domain or display name (at most 100 characters).",
    required: false,
    schema: { type: "string", maxLength: 100 },
  },
];

const CURSOR_PARAM: RouteQueryParam = {
  name: "cursor",
  description: "The previous page's nextCursor (opaque, base64url).",
  required: false,
  schema: { type: "string", maxLength: 200, pattern: "^[A-Za-z0-9_-]*$" },
};

const ORG_DOMAIN_PARAM: RoutePathParam = {
  name: "orgDomain",
  description: "The lead's registrable domain (case-insensitive), in the caller's own region.",
  schema: { type: "string" },
};

const BAD_QUERY_400: RouteErrorResponse = {
  status: 400,
  description:
    "The query failed Zod validation (nestjs-zod's global ZodValidationPipe), or the cursor is not " +
    "one this list gave out ({ code: invalid_cursor, message }).",
  documented: false,
};

const LEAD_NOT_FOUND: RouteErrorResponse = {
  status: 404,
  description: "No such lead in the caller's region (not_found).",
  documented: true,
};

export const SPAMBANK_STAFF_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/staff/spambank/leads",
    summary: "List the brands that mailed Spambank users in the caller's region",
    tags: ["staff", "spambank"],
    pathParams: [],
    queryParams: [...LEAD_FILTERS, CURSOR_PARAM],
    successStatus: 200,
    successDescription: `Newest sighting first (then domain), ${String(LEAD_PAGE_SIZE)} a page; nextCursor is null on the last page. ops and support.`,
    successSchema: inlineSchema(spambankLeadPageSchema),
    errors: [BAD_QUERY_400, FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/staff/spambank/leads/export.csv",
    summary: "Download the caller's region's leads as CSV",
    tags: ["staff", "spambank"],
    pathParams: [],
    queryParams: LEAD_FILTERS,
    successStatus: 200,
    successContentType: "text/csv",
    successDescription:
      `One header row of the list's item field names, then every matching lead, up to ${String(LEAD_EXPORT_MAX)} ` +
      "(RFC 4180 quoting; a cell that starts like a spreadsheet formula gets a leading quote). " +
      "Content-Disposition attachment, spambank-leads-<region>-<yyyy-mm-dd>.csv. ops and support.",
    successSchema: { type: "string" },
    errors: [BAD_QUERY_400, FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "patch",
    path: "/api/staff/spambank/leads/{orgDomain}",
    summary: "Set a lead's status and/or note",
    tags: ["staff", "spambank"],
    pathParams: [ORG_DOMAIN_PARAM],
    requestBody: {
      description: "A status, a note (null or empty clears it), or both.",
      schema: inlineSchema(spambankLeadUpdateSchema),
    },
    successStatus: 200,
    successDescription: "The lead as it is now. ops only.",
    successSchema: inlineSchema(spambankLeadSchema),
    errors: [VALIDATION_400, FORBIDDEN, LEAD_NOT_FOUND, PDP_UNAVAILABLE],
  },
  {
    method: "get",
    path: "/api/staff/spambank/autoreply",
    summary:
      "The counter-spam auto-reply's state: mode, kill switch, pause, cap, today, blocklists",
    tags: ["staff", "spambank"],
    pathParams: [],
    successStatus: 200,
    successDescription:
      "Global, not regional. lastBlocklist is the latest result per target and list. admin and ops.",
    successSchema: inlineSchema(spambankAutoreplySchema),
    errors: [FORBIDDEN, PDP_UNAVAILABLE],
  },
  {
    method: "post",
    path: "/api/staff/spambank/autoreply",
    summary:
      "Trip or clear the auto-reply kill switch, change the daily cap, or resume after a pause",
    tags: ["staff", "spambank"],
    pathParams: [],
    requestBody: {
      description:
        "At least one of tripped, dailyCap or resume, and the reason (3 to 500 characters), which is audited.",
      schema: inlineSchema(spambankAutoreplyChangeSchema),
    },
    successStatus: 200,
    successDescription:
      "The state as it is now (the same body as GET). The change takes effect on the next reply claim. admin and ops.",
    successSchema: inlineSchema(spambankAutoreplySchema),
    errors: [VALIDATION_400, FORBIDDEN, PDP_UNAVAILABLE],
  },
];

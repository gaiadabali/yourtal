import {
  FORBIDDEN,
  TENANT_ID_PARAM,
  nestDefaultError,
  ref,
  type RouteDefinition,
  type RoutePathParam,
  type RouteQueryParam,
} from "./route-registry-shared";

/** 5.3 / 14.9: GST invoices, for a business in Studio and for staff. */
const INVOICE_ID_PARAM: RoutePathParam = {
  name: "invoiceId",
  description: "An invoice id (from the list).",
  schema: { type: "string", format: "uuid" },
};

const PDF_SCHEMA = { type: "string", format: "binary" };

const NOT_FOUND = nestDefaultError(
  404,
  "No such invoice, or it belongs to another business (the two look the same).",
);

const STAFF_QUERY: readonly RouteQueryParam[] = [
  {
    name: "region",
    description: "Only this region's invoices (AU or ID).",
    required: false,
    schema: { type: "string", enum: ["AU", "ID"] },
  },
  {
    name: "businessId",
    description: "Only this business's invoices.",
    required: false,
    schema: { type: "string", format: "uuid" },
  },
  {
    name: "limit",
    description: "At most this many (1 to 500, default 100).",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 500 },
  },
];

export const INVOICE_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "get",
    path: "/api/{tenantId}/studio/invoices",
    summary: "This business's invoices, newest first",
    tags: ["studio", "billing", "invoices"],
    pathParams: [TENANT_ID_PARAM],
    successStatus: 200,
    successDescription: "Every invoice issued to this business.",
    successSchema: ref("InvoiceList"),
    errors: [FORBIDDEN],
  },
  {
    method: "get",
    path: "/api/{tenantId}/studio/invoices/{invoiceId}/pdf",
    summary: "Download one of this business's invoices as a PDF",
    tags: ["studio", "billing", "invoices"],
    pathParams: [TENANT_ID_PARAM, INVOICE_ID_PARAM],
    successStatus: 200,
    successDescription:
      "The PDF, rendered from the stored snapshot, sent with Content-Disposition: attachment.",
    successContentType: "application/pdf",
    successSchema: PDF_SCHEMA,
    errors: [FORBIDDEN, NOT_FOUND],
  },
  {
    method: "get",
    path: "/api/staff/invoices",
    summary: "Staff: invoices in any region or business",
    tags: ["staff", "invoices"],
    pathParams: [],
    queryParams: STAFF_QUERY,
    successStatus: 200,
    successDescription: "Matching invoices, newest first. The call is audited.",
    successSchema: ref("InvoiceList"),
    errors: [
      FORBIDDEN,
      nestDefaultError(400, "A query value is not valid (region, businessId or limit)."),
    ],
  },
  {
    method: "get",
    path: "/api/staff/invoices/gst-report",
    summary: "Staff (finance): the quarterly GST report as a CSV",
    tags: ["staff", "invoices"],
    pathParams: [],
    queryParams: [
      {
        name: "quarter",
        description:
          "A calendar quarter as YYYY-Q1 to YYYY-Q4 (Oct to Dec is Q4). Or give from and to.",
        required: false,
        schema: { type: "string", pattern: "^\\d{4}-Q[1-4]$" },
      },
      {
        name: "from",
        description: "First day, YYYY-MM-DD, Australian time. With `to`; not with `quarter`.",
        required: false,
        schema: { type: "string", format: "date" },
      },
      {
        name: "to",
        description: "Last day, inclusive. The range is under a year.",
        required: false,
        schema: { type: "string", format: "date" },
      },
    ],
    successStatus: 200,
    successDescription:
      "One row per AU invoice or credit note (amounts in integer minor units), then a totals block. Sent as an attachment; the call is audited.",
    successContentType: "text/csv",
    successSchema: { type: "string" },
    errors: [FORBIDDEN, nestDefaultError(400, "Neither a quarter nor a valid from/to range.")],
  },
  {
    method: "get",
    path: "/api/staff/invoices/{invoiceId}/pdf",
    summary: "Staff: download any invoice as a PDF",
    tags: ["staff", "invoices"],
    pathParams: [INVOICE_ID_PARAM],
    successStatus: 200,
    successDescription: "The PDF, sent with Content-Disposition: attachment. The call is audited.",
    successContentType: "application/pdf",
    successSchema: PDF_SCHEMA,
    errors: [FORBIDDEN, nestDefaultError(404, "No such invoice.")],
  },
];

import type { Queryable } from "./types";

/**
 * 6.12.a: the quarterly GST report. Everything YourTal invoiced in Australia in
 * a period, as one CSV for the books. Amounts are integer minor units (AUD
 * cents) and are never formatted into dollars here. Indonesia is out: it issues
 * no invoices while it is a demo (F104), so only AU rows are ever read.
 */

export type GstDocumentType = "invoice" | "credit_note";
export type GstReportKind =
  "points_package" | "receipt_package" | "boost" | "points_manual_purchase";

export interface GstReportRow {
  readonly documentType: GstDocumentType;
  readonly number: string;
  /** Calendar date in Australian time, `YYYY-MM-DD`. */
  readonly date: string;
  readonly business: string;
  readonly businessAbn: string | null;
  readonly kind: GstReportKind;
  /** Signed: a credit note carries negative amounts. */
  readonly netMinor: number;
  readonly gstMinor: number;
  readonly totalMinor: number;
  readonly taxInvoice: boolean;
  /** The invoice a credit note adjusts; `null` on an invoice. */
  readonly originalNumber: string | null;
}

export interface GstPeriod {
  /** Inclusive, `YYYY-MM-DD`. */
  readonly from: string;
  /** Inclusive, `YYYY-MM-DD`. */
  readonly to: string;
  /** `2026-Q4` for a quarter, `2026-10-05_2026-10-20` for a range. */
  readonly label: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER = /^(\d{4})-Q([1-4])$/i;
const MAX_RANGE_DAYS = 366;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * `quarter=2026-Q4` is the three months Oct to Dec 2026 (the ATO's quarter 2 of
 * FY2027); or `from` and `to`, both inclusive. `null` when the input is neither.
 */
export function parseGstPeriod(input: {
  quarter?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): GstPeriod | null {
  if (input.quarter !== undefined) {
    if (input.from !== undefined || input.to !== undefined) return null;
    const match = QUARTER.exec(input.quarter);
    if (match === null) return null;
    const year = Number(match[1]);
    const startMonth = (Number(match[2]) - 1) * 3; // 0-based
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = new Date(Date.UTC(year, startMonth + 3, 0));
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      label: `${String(year)}-Q${match[2] ?? ""}`,
    };
  }
  if (input.from === undefined || input.to === undefined) return null;
  if (!isRealDate(input.from) || !isRealDate(input.to) || input.from > input.to) return null;
  const days =
    (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000;
  if (days >= MAX_RANGE_DAYS) return null;
  return { from: input.from, to: input.to, label: `${input.from}_${input.to}` };
}

interface ReportDbRow {
  number: string;
  day: string;
  buyer_legal_name: string;
  buyer_abn: string | null;
  source_kind: string;
  programme: string | null;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
  is_tax_invoice: boolean;
}

function kindOf(sourceKind: string, programme: string | null): GstReportKind {
  if (sourceKind === "boost_batch") return "boost";
  if (sourceKind === "manual_purchase") return "points_manual_purchase";
  return programme === "receipts" ? "receipt_package" : "points_package";
}

/**
 * The AU invoices dated in the period (Australia/Sydney calendar days), oldest
 * first. There is no credit or adjustment note table yet (F107: purchases are
 * final), so this returns invoices only; `buildGstReport` already handles
 * `credit_note` rows for when one exists.
 */
export async function loadGstReportRows(db: Queryable, period: GstPeriod): Promise<GstReportRow[]> {
  const { rows } = await db.query<ReportDbRow>(
    `SELECT i.number,
            to_char(i.issued_at AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS day,
            i.buyer_legal_name, i.buyer_abn, i.source_kind, p.programme,
            i.subtotal_minor::text, i.tax_minor::text, i.total_minor::text, i.is_tax_invoice
       FROM invoice.invoice i
       LEFT JOIN payment.card_purchase p
         ON i.source_kind = 'card_purchase' AND p.id = i.source_id
      WHERE i.region = 'AU'
        AND (i.issued_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN $1::date AND $2::date
      ORDER BY i.issued_at, i.number`,
    [period.from, period.to],
  );
  return rows.map((row) => ({
    documentType: "invoice",
    number: row.number,
    date: row.day,
    business: row.buyer_legal_name,
    businessAbn: row.buyer_abn,
    kind: kindOf(row.source_kind, row.programme),
    netMinor: Number(row.subtotal_minor),
    gstMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    taxInvoice: row.is_tax_invoice,
    originalNumber: null,
  }));
}

export interface GstReportTotals {
  readonly invoiceCount: number;
  readonly adjustmentCount: number;
  /** Net of invoices that charged GST. */
  readonly taxableSalesMinor: number;
  /** Net of invoices that charged none (a zero GST rate). */
  readonly gstFreeSalesMinor: number;
  readonly gstCollectedMinor: number;
  /** Credit notes: negative, like their rows. */
  readonly adjustmentsNetMinor: number;
  readonly adjustmentsGstMinor: number;
  /** GST collected less the GST on adjustments. */
  readonly netGstMinor: number;
}

export function totalsOf(rows: readonly GstReportRow[]): GstReportTotals {
  let invoiceCount = 0;
  let adjustmentCount = 0;
  let taxableSalesMinor = 0;
  let gstFreeSalesMinor = 0;
  let gstCollectedMinor = 0;
  let adjustmentsNetMinor = 0;
  let adjustmentsGstMinor = 0;
  for (const row of rows) {
    if (row.documentType === "credit_note") {
      adjustmentCount += 1;
      adjustmentsNetMinor += row.netMinor;
      adjustmentsGstMinor += row.gstMinor;
    } else {
      invoiceCount += 1;
      gstCollectedMinor += row.gstMinor;
      if (row.gstMinor > 0) taxableSalesMinor += row.netMinor;
      else gstFreeSalesMinor += row.netMinor;
    }
  }
  return {
    invoiceCount,
    adjustmentCount,
    taxableSalesMinor,
    gstFreeSalesMinor,
    gstCollectedMinor,
    adjustmentsNetMinor,
    adjustmentsGstMinor,
    netGstMinor: gstCollectedMinor + adjustmentsGstMinor,
  };
}

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break; and a text
 * value a spreadsheet would run as a formula (a business named "=HYPERLINK(...)")
 * is defused with a leading apostrophe.
 */
function cell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADER = [
  "invoice_number",
  "date",
  "business",
  "business_abn",
  "kind",
  "document",
  "net_minor",
  "gst_minor",
  "total_minor",
  "currency",
  "tax_invoice",
  "original_invoice_number",
] as const;

/** The report: one row per invoice or credit note, a blank line, then the totals block. */
export function buildGstReportCsv(period: GstPeriod, rows: readonly GstReportRow[]): string {
  const lines: string[] = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.number,
        row.date,
        row.business,
        row.businessAbn,
        row.kind,
        row.documentType,
        row.netMinor,
        row.gstMinor,
        row.totalMinor,
        "AUD",
        row.taxInvoice,
        row.originalNumber,
      ]
        .map(cell)
        .join(","),
    );
  }
  const totals = totalsOf(rows);
  lines.push("");
  lines.push(["totals", "period", period.label, "from", period.from, "to", period.to].join(","));
  const total = (name: string, value: number): void => {
    lines.push([name, value].map(cell).join(","));
  };
  total("invoice_count", totals.invoiceCount);
  total("adjustment_count", totals.adjustmentCount);
  total("taxable_sales_net_minor", totals.taxableSalesMinor);
  total("gst_free_sales_net_minor", totals.gstFreeSalesMinor);
  total("gst_collected_minor", totals.gstCollectedMinor);
  total("adjustments_net_minor", totals.adjustmentsNetMinor);
  total("adjustments_gst_minor", totals.adjustmentsGstMinor);
  total("net_gst_minor", totals.netGstMinor);
  return `${lines.join("\r\n")}\r\n`;
}

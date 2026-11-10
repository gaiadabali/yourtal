import { describe, expect, it } from "vitest";
import { buildGstReportCsv, parseGstPeriod, totalsOf, type GstReportRow } from "./gst-report";

const invoice = (over: Partial<GstReportRow>): GstReportRow => ({
  documentType: "invoice",
  number: "YT-AU-000001",
  date: "2026-10-05",
  business: "Bondi Beans Pty Ltd",
  businessAbn: "51824753556",
  kind: "points_package",
  netMinor: 45_000,
  gstMinor: 4_500,
  totalMinor: 49_500,
  taxInvoice: true,
  originalNumber: null,
  ...over,
});

describe("parseGstPeriod (6.12.a)", () => {
  it("turns a calendar quarter into its first and last day", () => {
    expect(parseGstPeriod({ quarter: "2026-Q4" })).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
      label: "2026-Q4",
    });
    expect(parseGstPeriod({ quarter: "2028-Q1" })).toMatchObject({
      from: "2028-01-01",
      to: "2028-03-31",
    });
    expect(parseGstPeriod({ quarter: "2026-Q2" })).toMatchObject({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("takes an inclusive range, and refuses anything else", () => {
    expect(parseGstPeriod({ from: "2026-10-05", to: "2026-10-20" })).toMatchObject({
      from: "2026-10-05",
      to: "2026-10-20",
    });
    expect(parseGstPeriod({})).toBeNull();
    expect(parseGstPeriod({ quarter: "2026-Q5" })).toBeNull();
    expect(parseGstPeriod({ quarter: "2026-Q1", from: "2026-01-01", to: "2026-01-02" })).toBeNull();
    expect(parseGstPeriod({ from: "2026-10-20", to: "2026-10-05" })).toBeNull();
    expect(parseGstPeriod({ from: "2026-02-30", to: "2026-03-05" })).toBeNull();
    expect(parseGstPeriod({ from: "2025-01-01", to: "2026-06-01" })).toBeNull();
    expect(parseGstPeriod({ from: "2026-10-05" })).toBeNull();
  });
});

describe("the GST report CSV (6.12.a)", () => {
  const period = parseGstPeriod({ quarter: "2026-Q4" });
  if (period === null) throw new Error("fixture quarter must parse");
  const rows: GstReportRow[] = [
    invoice({}),
    invoice({
      number: "YT-AU-000002",
      date: "2026-11-02",
      kind: "boost",
      netMinor: 10_000,
      gstMinor: 1_000,
      totalMinor: 11_000,
    }),
    invoice({
      number: "YT-AU-000003",
      date: "2026-11-09",
      kind: "receipt_package",
      business: 'Smith, "Jones" & Co',
      netMinor: 20_000,
      gstMinor: 2_000,
      totalMinor: 22_000,
    }),
    // A credit note against the first invoice: half of it, signed negative.
    invoice({
      documentType: "credit_note",
      number: "YT-AU-CN-000001",
      date: "2026-11-20",
      netMinor: -22_500,
      gstMinor: -2_250,
      totalMinor: -24_750,
      originalNumber: "YT-AU-000001",
    }),
  ];

  it("totals taxable sales, GST collected and adjustments, and nets the GST", () => {
    expect(totalsOf(rows)).toEqual({
      invoiceCount: 3,
      adjustmentCount: 1,
      taxableSalesMinor: 75_000,
      gstFreeSalesMinor: 0,
      gstCollectedMinor: 7_500,
      adjustmentsNetMinor: -22_500,
      adjustmentsGstMinor: -2_250,
      netGstMinor: 5_250,
    });
  });

  it("writes a header, one row per document with the credit note linked to its invoice, then the totals block", () => {
    const lines = buildGstReportCsv(period, rows).split("\r\n");
    expect(lines[0]).toBe(
      "invoice_number,date,business,business_abn,kind,document,net_minor,gst_minor,total_minor,currency,tax_invoice,original_invoice_number",
    );
    expect(lines[1]).toBe(
      "YT-AU-000001,2026-10-05,Bondi Beans Pty Ltd,51824753556,points_package,invoice,45000,4500,49500,AUD,true,",
    );
    expect(lines[3]).toBe(
      'YT-AU-000003,2026-11-09,"Smith, ""Jones"" & Co",51824753556,receipt_package,invoice,20000,2000,22000,AUD,true,',
    );
    expect(lines[4]).toBe(
      "YT-AU-CN-000001,2026-11-20,Bondi Beans Pty Ltd,51824753556,points_package,credit_note,-22500,-2250,-24750,AUD,true,YT-AU-000001",
    );
    expect(lines.slice(5)).toEqual([
      "",
      "totals,period,2026-Q4,from,2026-10-01,to,2026-12-31",
      "invoice_count,3",
      "adjustment_count,1",
      "taxable_sales_net_minor,75000",
      "gst_free_sales_net_minor,0",
      "gst_collected_minor,7500",
      "adjustments_net_minor,-22500",
      "adjustments_gst_minor,-2250",
      "net_gst_minor,5250",
      "",
    ]);
  });

  it("is just a header and zero totals for an empty quarter", () => {
    const csv = buildGstReportCsv(period, []);
    expect(csv).toContain("invoice_count,0");
    expect(csv).toContain("net_gst_minor,0");
  });

  it("defuses a business name a spreadsheet would run as a formula", () => {
    const csv = buildGstReportCsv(period, [invoice({ business: '=HYPERLINK("http://x")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

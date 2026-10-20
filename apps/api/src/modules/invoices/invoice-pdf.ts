import PDFDocument from "pdfkit";
import type { Invoice } from "@yourtal/contracts/invoice";
import { formatAbn, invoiceTitle } from "@yourtal/contracts/invoice/rules";

/**
 * Renders an invoice as a one-page A4 PDF from its stored snapshot alone, so a
 * re-render is byte-identical (the creation date is the issue date, and
 * pdfkit derives the file id from the document info). Standard fonts only: no
 * font files, no network. The wording follows the ATO's tax-invoice content;
 * while the issuer has no valid ABN the title is "Invoice" and the page says
 * it is not a tax invoice.
 */
const MARGIN = 50;
const PAGE_RIGHT = 595.28 - MARGIN;
const COLUMNS = {
  description: { x: MARGIN, width: 215 },
  quantity: { x: 270, width: 40 },
  unit: { x: 315, width: 75 },
  gst: { x: 395, width: 65 },
  amount: { x: 465, width: PAGE_RIGHT - 465 },
} as const;
const GREY = "#555555";

const NUMBER_FORMAT = {
  AUD: new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  IDR: new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }),
} as const;
const DATE_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Australia/Sydney",
});

/** A$1,234.56 (en-AU); IDR is whole rupiah. */
export function formatInvoiceMoney(minor: number, currency: Invoice["currency"]): string {
  return currency === "AUD"
    ? `A$${NUMBER_FORMAT.AUD.format(minor / 100)}`
    : `Rp${NUMBER_FORMAT.IDR.format(minor)}`;
}

/** The standard fonts cover Latin-1 only; anything else prints as "?", never garbage. */
function latin1(text: string): string {
  return Array.from(text, (character) => (character.charCodeAt(0) <= 0xff ? character : "?")).join(
    "",
  );
}

function gstLabel(invoice: Invoice): string {
  const percent = invoice.taxRateBps / 100;
  return `GST (${Number.isInteger(percent) ? String(percent) : percent.toFixed(2)}%)`;
}

function drawHeader(doc: PDFKit.PDFDocument, invoice: Invoice): void {
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#000000");
  doc.text(invoiceTitle(invoice.isTaxInvoice), MARGIN, MARGIN);
  doc.font("Helvetica").fontSize(10).fillColor(GREY);
  doc.text(`Number: ${invoice.number}`, MARGIN, 85);
  doc.text(`Date of issue: ${DATE_FORMAT.format(new Date(invoice.issuedAt))}`);
  if (invoice.paymentRef !== null) doc.text(`Payment reference: ${latin1(invoice.paymentRef)}`);
  if (!invoice.isTaxInvoice) {
    doc.font("Helvetica-Oblique").fillColor("#000000");
    doc.text("This document is not a tax invoice.", MARGIN, doc.y + 4);
  }
}

function drawParties(doc: PDFKit.PDFDocument, invoice: Invoice, top: number): number {
  const { issuer, buyer } = invoice;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("FROM", MARGIN, top);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000").text(latin1(issuer.legalName));
  doc.font("Helvetica").fontSize(10);
  if (issuer.abn !== null) doc.text(`ABN ${formatAbn(issuer.abn)}`);
  doc.text(latin1(issuer.address), { width: 230 });
  doc.text(latin1(issuer.email));
  const fromBottom = doc.y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("BILLED TO", 320, top);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000000")
    .text(latin1(buyer.legalName), 320, doc.y, {
      width: PAGE_RIGHT - 320,
    });
  doc.font("Helvetica").fontSize(10);
  // The ATO wants the buyer's identity or ABN from A$1,000: the legal name is
  // always printed, and the ABN too when the business has one.
  if (buyer.abn !== null) doc.text(`ABN ${formatAbn(buyer.abn)}`, 320);
  return Math.max(fromBottom, doc.y) + 24;
}

function drawLines(doc: PDFKit.PDFDocument, invoice: Invoice, top: number): number {
  const heading = (label: string, column: { x: number; width: number }, align: "left" | "right") =>
    doc.text(label, column.x, top, { width: column.width, align });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY);
  heading("DESCRIPTION", COLUMNS.description, "left");
  heading("QTY", COLUMNS.quantity, "right");
  heading("PRICE EX GST", COLUMNS.unit, "right");
  heading("GST", COLUMNS.gst, "right");
  heading("AMOUNT EX GST", COLUMNS.amount, "right");
  doc
    .moveTo(MARGIN, top + 14)
    .lineTo(PAGE_RIGHT, top + 14)
    .strokeColor("#999999")
    .stroke();

  let y = top + 22;
  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  for (const line of invoice.lines) {
    const rowTop = y;
    doc.text(latin1(line.description), COLUMNS.description.x, rowTop, {
      width: COLUMNS.description.width,
    });
    const bottom = doc.y;
    const cell = (text: string, column: { x: number; width: number }) =>
      doc.text(text, column.x, rowTop, { width: column.width, align: "right" });
    cell(String(line.quantity), COLUMNS.quantity);
    cell(formatInvoiceMoney(line.unitMinor, invoice.currency), COLUMNS.unit);
    cell(formatInvoiceMoney(line.taxMinor, invoice.currency), COLUMNS.gst);
    cell(formatInvoiceMoney(line.subtotalMinor, invoice.currency), COLUMNS.amount);
    y = Math.max(bottom, rowTop + 14) + 8;
  }
  doc.moveTo(MARGIN, y).lineTo(PAGE_RIGHT, y).strokeColor("#999999").stroke();
  return y + 12;
}

function drawTotals(doc: PDFKit.PDFDocument, invoice: Invoice, top: number): void {
  const label = { x: 330, width: 130 };
  const rows: { label: string; value: string; bold?: boolean }[] = [
    {
      label: "Subtotal (ex GST)",
      value: formatInvoiceMoney(invoice.subtotalMinor, invoice.currency),
    },
    { label: gstLabel(invoice), value: formatInvoiceMoney(invoice.taxMinor, invoice.currency) },
    {
      label: "Total (incl GST)",
      value: formatInvoiceMoney(invoice.totalMinor, invoice.currency),
      bold: true,
    },
  ];
  let y = top;
  for (const row of rows) {
    doc
      .font(row.bold === true ? "Helvetica-Bold" : "Helvetica")
      .fontSize(row.bold === true ? 11 : 10);
    doc.fillColor("#000000");
    doc.text(row.label, label.x, y, { width: label.width, align: "left" });
    doc.text(row.value, COLUMNS.amount.x - 10, y, {
      width: COLUMNS.amount.width + 10,
      align: "right",
    });
    y += row.bold === true ? 20 : 16;
  }
  doc.font("Helvetica").fontSize(9).fillColor(GREY);
  const note = invoice.isTaxInvoice
    ? `Total price includes GST of ${formatInvoiceMoney(invoice.taxMinor, invoice.currency)}.`
    : "The GST shown cannot be claimed as a credit from this document.";
  doc.text(note, MARGIN, y + 8, { width: PAGE_RIGHT - MARGIN });
  doc.text(
    `All amounts are in ${invoice.currency === "AUD" ? "Australian dollars (AUD)" : "Indonesian rupiah (IDR)"}. Paid in full.`,
  );
}

export function renderInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const issued = new Date(invoice.issuedAt);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `${invoiceTitle(invoice.isTaxInvoice)} ${invoice.number}`,
      Author: latin1(invoice.issuer.legalName),
      Creator: "YourTal",
      Producer: "YourTal",
      CreationDate: issued,
      ModDate: issued,
    },
  });
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);

    drawHeader(doc, invoice);
    const linesTop = drawParties(doc, invoice, 150);
    const totalsTop = drawLines(doc, invoice, linesTop + 20);
    drawTotals(doc, invoice, totalsTop);
    doc.end();
  });
}

import { describe, expect, it } from "vitest";
import { invoiceSchema } from "@yourtal/contracts/invoice";
import type { Invoice } from "@yourtal/contracts/invoice";
import { formatInvoiceMoney, renderInvoicePdf } from "./invoice-pdf";
import { pdfText } from "./testing/pdf-text";

const BASE: Invoice = invoiceSchema.parse({
  id: "5f0a3a8e-6a0e-4b0b-9a53-9d0a4f4b1c11",
  number: "YT-AU-000042",
  region: "AU",
  businessId: "0b9a3d8e-1f32-4f0c-8d8c-0f1e2d3c4b5a",
  sourceKind: "card_purchase",
  issuedAt: "2026-10-20T03:30:00.000Z",
  currency: "AUD",
  subtotalMinor: 4_500_000,
  taxMinor: 450_000,
  totalMinor: 4_950_000,
  taxRateBps: 1_000,
  isTaxInvoice: true,
  issuer: {
    legalName: "YourTal Pty Ltd",
    abn: "51824753556",
    address: "1 Example Street, Sydney NSW 2000",
    email: "billing@yourtal.example",
  },
  buyer: { legalName: "Bondi Beans Pty Ltd", abn: "12345678901" },
  paymentRef: "pi_123456789",
  lines: [
    {
      position: 1,
      description: "1,000,000 YourTal points",
      quantity: 1,
      unitMinor: 4_500_000,
      subtotalMinor: 4_500_000,
      taxMinor: 450_000,
    },
  ],
});

describe("formatInvoiceMoney", () => {
  it("writes en-AU dollars with grouping and cents", () => {
    expect(formatInvoiceMoney(123_456, "AUD")).toBe("A$1,234.56");
    expect(formatInvoiceMoney(5, "AUD")).toBe("A$0.05");
    expect(formatInvoiceMoney(0, "AUD")).toBe("A$0.00");
  });
});

const PRODUCTION = { demo: false } as const;

describe("renderInvoicePdf", () => {
  it("is a PDF whose text carries the title, number, ABNs, date and the GST lines", async () => {
    const pdf = await renderInvoicePdf(BASE, PRODUCTION);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");

    const text = pdfText(pdf);
    expect(text).toContain("Tax invoice");
    expect(text).not.toContain("not a tax invoice");
    expect(text).toContain("Number: YT-AU-000042");
    expect(text).toContain("Date of issue: 20 October 2026");
    expect(text).toContain("YourTal Pty Ltd");
    expect(text).toContain("ABN 51 824 753 556");
    expect(text).toContain("Bondi Beans Pty Ltd");
    expect(text).toContain("ABN 12 345 678 901");
    expect(text).toContain("1,000,000 YourTal points");
    expect(text).toContain("Subtotal (ex GST)");
    expect(text).toContain("A$45,000.00");
    expect(text).toContain("GST (10%)");
    expect(text).toContain("A$4,500.00");
    expect(text).toContain("Total (incl GST)");
    expect(text).toContain("A$49,500.00");
    expect(text).toContain("Total price includes GST of A$4,500.00.");
    expect(text).toContain("Payment reference: pi_123456789");
  });

  it("is titled Invoice and says so when the issuer has no ABN", async () => {
    const plain = invoiceSchema.parse({
      ...BASE,
      isTaxInvoice: false,
      issuer: { ...BASE.issuer, abn: null },
    });
    const text = pdfText(await renderInvoicePdf(plain, PRODUCTION));
    expect(text).toContain("Invoice");
    expect(text).not.toContain("Tax invoice");
    expect(text).toContain("This document is not a tax invoice.");
    expect(text).not.toContain("ABN 51");
    // The buyer is still named.
    expect(text).toContain("Bondi Beans Pty Ltd");
  });

  it("is identical every time it is rendered from the same snapshot", async () => {
    const first = await renderInvoicePdf(BASE, PRODUCTION);
    const second = await renderInvoicePdf(BASE, PRODUCTION);
    expect(second.equals(first)).toBe(true);
  });

  it("says on the page, outside production, that it is a demo document", async () => {
    const demo = pdfText(await renderInvoicePdf(BASE, { demo: true }));
    expect(demo).toContain("Tax invoice");
    expect(demo).toContain("Demo document from a YourTal test environment");
    expect(demo).toContain("Not valid for GST or any other tax purpose.");
    expect(demo).toContain("DEMO");
    // Everything a real one carries is still there.
    expect(demo).toContain("ABN 51 824 753 556");
    expect(demo).toContain("Total price includes GST of A$4,500.00.");
    expect(pdfText(await renderInvoicePdf(BASE, PRODUCTION))).not.toContain("Demo document");
  });

  it("prints a character the standard fonts lack as a question mark, never garbage", async () => {
    const odd = invoiceSchema.parse({
      ...BASE,
      lines: [{ ...BASE.lines[0], description: "Boost for “Spring” \u{1F355}" }],
    });
    expect(pdfText(await renderInvoicePdf(odd, PRODUCTION))).toContain("Boost for ?Spring? ?");
  });
});

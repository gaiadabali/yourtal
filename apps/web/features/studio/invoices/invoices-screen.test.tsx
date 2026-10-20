import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { invoiceSchema } from "@yourtal/contracts/invoice";
import type { Invoice } from "@yourtal/contracts/invoice";
import { InvoicesScreen, invoicePdfHref } from "./invoices-screen";

const BUSINESS_ID = "0b9a3d8e-1f32-4f0c-8d8c-0f1e2d3c4b5a";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return invoiceSchema.parse({
    id: "5f0a3a8e-6a0e-4b0b-9a53-9d0a4f4b1c11",
    number: "YT-AU-000042",
    region: "AU",
    businessId: BUSINESS_ID,
    sourceKind: "card_purchase",
    issuedAt: "2026-10-20T03:30:00.000Z",
    currency: "AUD",
    subtotalMinor: 45_000,
    taxMinor: 4_500,
    totalMinor: 49_500,
    taxRateBps: 1_000,
    isTaxInvoice: false,
    issuer: {
      legalName: "YourTal Demo Pty Ltd",
      abn: null,
      address: "Demo address only",
      email: "billing@demo.yourtal.example",
    },
    buyer: { legalName: "Bondi Beans Pty Ltd", abn: null },
    paymentRef: "pi_1",
    lines: [
      {
        position: 1,
        description: "10,000 YourTal points",
        quantity: 1,
        unitMinor: 45_000,
        subtotalMinor: 45_000,
        taxMinor: 4_500,
      },
    ],
    ...overrides,
  });
}

describe("InvoicesScreen", () => {
  it("lists the number, date, document, total and a PDF download for each invoice", () => {
    render(<InvoicesScreen businessId={BUSINESS_ID} invoices={[invoice()]} locale="en-AU" />);

    // A DataTable renders a table and a stacked card list; the table is the one to read.
    const table = screen.getByRole("table", { hidden: true, name: "Invoices for your purchases" });
    const row = within(table).getAllByRole("row", { hidden: true })[1];
    if (row === undefined) throw new Error("no invoice row");
    expect(within(row).getByText("YT-AU-000042")).toBeInTheDocument();
    expect(within(row).getByText("10,000 YourTal points")).toBeInTheDocument();
    expect(within(row).getByText("Invoice")).toBeInTheDocument();
    expect(within(row).getByText("$495.00")).toBeInTheDocument();
    expect(within(row).getByText(/20 Oct 2026/)).toBeInTheDocument();

    const link = within(row).getByRole("link", {
      hidden: true,
      name: "Download the PDF for invoice YT-AU-000042",
    });
    expect(link).toHaveAttribute("href", invoicePdfHref(BUSINESS_ID, invoice().id));
    expect(link).toHaveAttribute("download", "YT-AU-000042.pdf");
    expect(invoicePdfHref(BUSINESS_ID, "abc")).toBe(
      `/studio/billing/invoices/abc/pdf?business=${BUSINESS_ID}`,
    );
  });

  it("calls a document a Tax invoice only when it was issued as one", () => {
    render(
      <InvoicesScreen
        businessId={BUSINESS_ID}
        invoices={[
          invoice({
            isTaxInvoice: true,
            issuer: {
              legalName: "YourTal Pty Ltd",
              abn: "51824753556",
              address: "1 Example Street",
              email: "billing@yourtal.example",
            },
          }),
        ]}
        locale="en-AU"
      />,
    );
    expect(screen.getAllByText("Tax invoice").length).toBeGreaterThan(0);
  });

  it("says so when there are no invoices yet, and offers no download", () => {
    render(<InvoicesScreen businessId={BUSINESS_ID} invoices={[]} locale="en-AU" />);
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { hidden: true })).toBeNull();
  });

  it("speaks Indonesian to an id-ID viewer", () => {
    render(<InvoicesScreen businessId={BUSINESS_ID} invoices={[invoice()]} locale="id-ID" />);
    expect(
      screen.getByText("Faktur untuk pembelian Anda", { selector: "caption" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unduh PDF").length).toBeGreaterThan(0);
    expect(screen.queryByText("Download PDF")).toBeNull();
  });
});

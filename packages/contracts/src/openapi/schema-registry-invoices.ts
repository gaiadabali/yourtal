import {
  invoiceBuyerSchema,
  invoiceIssuerSchema,
  invoiceLineSchema,
  invoiceListSchema,
  invoiceSchema,
  invoiceSourceKindSchema,
} from "../invoice/invoice";
import type { ContractComponent } from "./schema-registry";

/** 5.3: GST tax invoices, split out of `schema-registry.ts` for its line ceiling. */
export const INVOICE_CONTRACT_COMPONENTS: readonly ContractComponent[] = [
  {
    id: "InvoiceSourceKind",
    schema: invoiceSourceKindSchema,
    description:
      "What an invoice is for: a card purchase of points, a charged boost batch, or a purchase staff approved by hand. A source is invoiced once.",
    crossFieldRules: [],
  },
  {
    id: "InvoiceLine",
    schema: invoiceLineSchema,
    description:
      "One line of an invoice: quantity x unitMinor = subtotalMinor (ex-GST), with its GST in taxMinor.",
    crossFieldRules: [],
  },
  {
    id: "InvoiceIssuer",
    schema: invoiceIssuerSchema,
    description:
      "The issuing company as it was when the invoice was issued (from the invoice_issuer region setting). abn is null while the company has none.",
    crossFieldRules: [],
  },
  {
    id: "InvoiceBuyer",
    schema: invoiceBuyerSchema,
    description:
      "The business as it was when the invoice was issued: its legal name, and its ABN only if it holds a valid one.",
    crossFieldRules: [],
  },
  {
    id: "Invoice",
    schema: invoiceSchema,
    description:
      "5.3 (F118): a GST invoice, a snapshot that never changes after issue. totalMinor = subtotalMinor (ex-GST) + taxMinor (GST at taxRateBps). isTaxInvoice is true only while the issuer's ABN is set and valid; otherwise the document is a plain invoice and says it is not a tax invoice.",
    crossFieldRules: [],
  },
  {
    id: "InvoiceList",
    schema: invoiceListSchema,
    description: "Invoices, newest first.",
    crossFieldRules: [],
  },
];

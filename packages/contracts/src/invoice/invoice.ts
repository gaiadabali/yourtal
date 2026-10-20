import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 5.3: GST tax invoices. An invoice is a snapshot taken when it was issued
 * (the issuer's and buyer's details included), so what Studio lists and what
 * the PDF prints never change afterwards. Amounts come from the source that
 * was paid: subtotal is ex-GST, `taxMinor` is the GST, total is what was
 * charged (F118).
 */
export const invoiceSourceKindSchema = z.enum(["card_purchase", "boost_batch", "manual_purchase"]);
export type InvoiceSourceKind = z.infer<typeof invoiceSourceKindSchema>;

export const invoiceLineSchema = z.object({
  position: z.number().int().positive(),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitMinor: minorUnitsSchema,
  subtotalMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** The issuing company, as `invoice_issuer` holds it in the region settings. */
export const invoiceIssuerSchema = z.object({
  legalName: z.string().trim().min(1),
  /** Eleven digits, or null while the company has none (the document is then not a tax invoice). */
  abn: z
    .string()
    .regex(/^\d{11}$/)
    .nullable(),
  address: z.string().trim().min(1),
  email: z.string().trim().min(1),
});
export type InvoiceIssuer = z.infer<typeof invoiceIssuerSchema>;

export const invoiceBuyerSchema = z.object({
  legalName: z.string().min(1),
  abn: z.string().nullable(),
});
export type InvoiceBuyer = z.infer<typeof invoiceBuyerSchema>;

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string().regex(/^YT-(AU|ID)-\d{6,}$/),
  region: regionSchema,
  businessId: z.uuid(),
  sourceKind: invoiceSourceKindSchema,
  issuedAt: z.iso.datetime(),
  currency: currencySchema,
  subtotalMinor: minorUnitsSchema,
  taxMinor: minorUnitsSchema,
  totalMinor: minorUnitsSchema,
  taxRateBps: z.number().int().min(0).max(10_000),
  /** False while the issuer has no valid ABN: the document says "Invoice", not "Tax invoice". */
  isTaxInvoice: z.boolean(),
  issuer: invoiceIssuerSchema,
  buyer: invoiceBuyerSchema,
  paymentRef: z.string().nullable(),
  lines: z.array(invoiceLineSchema).min(1),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceListSchema = z.object({ invoices: z.array(invoiceSchema) });
export type InvoiceList = z.infer<typeof invoiceListSchema>;

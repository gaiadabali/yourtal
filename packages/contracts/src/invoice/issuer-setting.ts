import * as z from "zod";
import { isValidAbn } from "./abn";

/**
 * 5.3.c (F118): the `invoice_issuer` region setting, as staff may propose it.
 * Checked when proposed and again when approved, so a half-filled company never
 * becomes the one invoices are issued from (the issuing job reads it with the
 * looser `invoiceIssuerSchema` and waits when it is bad). The ABN is null, or
 * eleven digits that pass the ATO checksum; spaces typed in it are allowed, as
 * the reader strips them.
 */
export const INVOICE_ISSUER_SETTING_KEY = "invoice_issuer";

export const invoiceIssuerSettingSchema = z.strictObject({
  legalName: z.string().trim().min(1).max(200),
  abn: z
    .string()
    .refine((abn) => isValidAbn(abn.replace(/ /g, "")), {
      message: "must be 11 digits that pass the ABN checksum, or null",
    })
    .nullable(),
  address: z.string().trim().min(1).max(500),
  email: z.string().trim().max(254).pipe(z.email()),
});
export type InvoiceIssuerSetting = z.infer<typeof invoiceIssuerSettingSchema>;

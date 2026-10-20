import { isValidAbn } from "./abn";

/**
 * What the ATO asks of a tax invoice, as pure rules (group 5.3). Seller's
 * identity and ABN, date, what was sold, the GST amount, and the buyer's
 * identity or ABN when the total is A$1,000 or more including GST.
 */

/** A$1,000 including GST, in cents: from here the buyer must be named. */
export const BUYER_DETAILS_THRESHOLD_MINOR = 100_000;

/** A document is a "Tax invoice" only while the issuer's ABN is set and valid. */
export function isTaxInvoiceFor(issuerAbn: string | null): boolean {
  return issuerAbn !== null && isValidAbn(issuerAbn);
}

export function invoiceTitle(isTaxInvoice: boolean): "Tax invoice" | "Invoice" {
  return isTaxInvoice ? "Tax invoice" : "Invoice";
}

/** The buyer's identity or ABN is required when the total reaches A$1,000. */
export function buyerDetailsRequired(totalMinor: number): boolean {
  return totalMinor >= BUYER_DETAILS_THRESHOLD_MINOR;
}

/** `YT-AU-000001`: one gapless run per region; the database checks the same shape. */
export function invoiceNumberOf(region: "AU" | "ID", seq: number): string {
  return `YT-${region}-${String(seq).padStart(6, "0")}`;
}

/** An ABN written the way the ATO prints it: `51 824 753 556`. */
export function formatAbn(abn: string): string {
  return /^\d{11}$/.test(abn)
    ? `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}`
    : abn;
}

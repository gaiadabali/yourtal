import type { Pool } from "pg";
import { issueInvoice } from "@yourtal/db/invoicing/issue";
import type { InvoiceSourceRef, IssueOutcome } from "@yourtal/db/invoicing/types";

export const INVOICE_ISSUER = Symbol("INVOICE_ISSUER");

/**
 * Issues the invoice for a paid source. Idempotent: a source is invoiced once,
 * whoever asks and however often. The logic is `@yourtal/db/invoicing/issue`'s, so the
 * worker (which may not import apps/api) runs exactly the same code; this is
 * the API's handle on it.
 */
export class InvoiceIssuer {
  constructor(private readonly pool: Pool) {}

  issueInvoice(source: InvoiceSourceRef): Promise<IssueOutcome> {
    return issueInvoice(this.pool, source);
  }
}

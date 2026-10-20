import type { Pool } from "pg";
import { issueInvoice } from "@yourtal/db/invoicing/issue";
import { findUninvoiced } from "@yourtal/db/invoicing/sources";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * 5.3 / 14.9: issues the GST invoice for everything a brand has paid for and
 * not yet been invoiced: paid card purchases, charged boost batches and
 * purchases staff approved by hand (AU only; Indonesia is a demo, F104).
 * Idempotent: a source is invoiced once, so a re-run, or a second worker, only
 * ever finds new sources. A source that cannot be invoiced yet (no company
 * details approved, say) is left for the next run.
 */
let pool: Pool | undefined;

export interface InvoiceIssueResult {
  readonly issued: number;
  readonly alreadyIssued: number;
  /** Not invoiceable yet; retried every run. */
  readonly skipped: number;
  readonly failed: number;
}

/** Exported for tests, like the other jobs' `run*` functions. */
export async function runInvoiceIssue(
  db: Pool,
  log: (message: string) => void = console.log,
): Promise<InvoiceIssueResult> {
  let issued = 0;
  let alreadyIssued = 0;
  let skipped = 0;
  let failed = 0;
  for (const source of await findUninvoiced(db)) {
    try {
      const outcome = await issueInvoice(db, source);
      if (outcome.status === "issued") issued += 1;
      else if (outcome.status === "exists") alreadyIssued += 1;
      else {
        skipped += 1;
        log(`[invoice-issue] ${source.kind} ${source.id} waits: ${outcome.reason}`);
      }
    } catch (error) {
      // One bad source must not hold back the rest; the job fails after the loop.
      failed += 1;
      log(
        `[invoice-issue] ${source.kind} ${source.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { issued, alreadyIssued, skipped, failed };
}

export const job = defineJob({
  queue: "invoice.issue",
  schedule: "*/5 * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    const result = await runInvoiceIssue(pool);
    if (result.failed > 0) throw new Error(`${String(result.failed)} invoice(s) failed to issue`);
  },
});

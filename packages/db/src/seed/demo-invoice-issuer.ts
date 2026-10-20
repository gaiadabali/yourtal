import type pg from "pg";

/**
 * Demo company details for invoices on staging and in dev (5.3). The
 * migration seeds nothing, so production waits for finance to approve the
 * real company; a demo environment would otherwise issue nothing at all.
 * There is no ABN, so every document is a plain "Invoice" that says it is not
 * a tax invoice.
 *
 * Idempotent, and it never overrides a person: once any approved
 * `invoice_issuer` exists for AU (this seed's or finance's), it does nothing.
 */
const DEMO_ISSUER = {
  legalName: "YourTal Demo Pty Ltd",
  abn: null,
  address: "Demo address only, Sydney NSW 2000",
  email: "billing@demo.yourtal.example",
} as const;

export async function ensureDemoInvoiceIssuer(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<"seeded" | "present"> {
  const { rowCount } = await pool.query(
    `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
     SELECT 'AU', 'invoice_issuer', $1::jsonb, 'seed-demo', 'seed-demo-approval', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM platform.region_setting
         WHERE region = 'AU' AND key = 'invoice_issuer' AND approved_by IS NOT NULL)`,
    [JSON.stringify(DEMO_ISSUER)],
  );
  if (rowCount === 1) {
    log("[seed] demo invoice issuer (no ABN) set for AU");
    return "seeded";
  }
  return "present";
}

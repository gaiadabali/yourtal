import { isDeepStrictEqual } from "node:util";
import type pg from "pg";

/**
 * Demo company details for invoices on staging and in dev (5.3). The
 * migration seeds nothing, so production waits for finance to approve the
 * real company (5.3.d, 6.1.a); a demo environment would otherwise issue
 * nothing at all.
 *
 * The ABN makes these real-shaped tax invoices, so the "Tax invoice" path
 * (the title, the ABN line, a named buyer from A$1,000) runs end to end on
 * staging before the company exists. 99 000 000 032 passes the ABN checksum
 * and is registered to nobody (ABN Lookup: "No record found", 2026-10-21),
 * so no real business is named. Outside production every PDF also says it is
 * a demo document (`invoice-pdf.ts`).
 */
export const DEMO_INVOICE_ISSUER = {
  legalName: "YourTal Demo Pty Ltd",
  abn: "99000000032",
  address: "Level 1, 100 Demo Street, Sydney NSW 2000",
  email: "billing@demo.yourtal.example",
} as const;

const SEED_SET_BY = "seed-demo";

/**
 * Idempotent, and it never overrides a person: it writes only while no
 * approved AU `invoice_issuer` exists, or while the one in force is this
 * seed's own and out of date (the earlier demo had no ABN). Once finance
 * approves any issuer, it does nothing. A new row each time, so the history
 * stays append-only like every region setting.
 */
export async function ensureDemoInvoiceIssuer(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<"seeded" | "upgraded" | "present"> {
  const { rows } = await pool.query<{ set_by: string; value: unknown }>(
    `SELECT set_by, value FROM platform.region_setting
      WHERE region = 'AU' AND key = 'invoice_issuer'
        AND approved_by IS NOT NULL AND effective_from <= now()
      ORDER BY effective_from DESC
      LIMIT 1`,
  );
  const current = rows[0];
  if (
    current !== undefined &&
    (current.set_by !== SEED_SET_BY || isDeepStrictEqual(current.value, DEMO_INVOICE_ISSUER))
  ) {
    return "present";
  }

  await pool.query(
    `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
     VALUES ('AU', 'invoice_issuer', $1::jsonb, $2, 'seed-demo-approval', now())`,
    [JSON.stringify(DEMO_INVOICE_ISSUER), SEED_SET_BY],
  );
  if (current === undefined) {
    log("[seed] demo invoice issuer (demo ABN) set for AU");
    return "seeded";
  }
  log("[seed] demo invoice issuer upgraded to the demo ABN for AU");
  return "upgraded";
}

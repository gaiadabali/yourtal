import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { invoiceIssuerSettingSchema } from "@yourtal/contracts/invoice/issuer-setting";
import { OWNER_URL } from "../database-urls";
import { DEMO_INVOICE_ISSUER, ensureDemoInvoiceIssuer } from "./demo-invoice-issuer";

/** The demo issuer seed against real Postgres: idempotent, upgrades only itself, never over a person's approval. */
const { Pool } = pg;
let owner: pg.Pool;
const quiet = () => undefined;

beforeAll(() => {
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
});
// Files run one at a time (vitest.config.ts), so this file owns AU's issuer while it runs.
beforeEach(async () => {
  await owner.query(
    `DELETE FROM platform.region_setting WHERE region = 'AU' AND key = 'invoice_issuer'`,
  );
});

async function approvedIssuers(): Promise<{ set_by: string; abn: string | null }[]> {
  const { rows } = await owner.query<{ set_by: string; abn: string | null }>(
    `SELECT set_by, value->>'abn' AS abn FROM platform.region_setting
      WHERE region = 'AU' AND key = 'invoice_issuer' AND approved_by IS NOT NULL
      ORDER BY effective_from`,
  );
  return rows;
}

/** A row approved now (the table refuses a backdated effective_from); the seed runs after it, so it is later. */
async function insertIssuer(setBy: string, value: unknown): Promise<void> {
  await owner.query(
    `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
     VALUES ('AU', 'invoice_issuer', $1::jsonb, $2, 'approver', now())`,
    [JSON.stringify(value), setBy],
  );
}

describe("ensureDemoInvoiceIssuer", () => {
  it("is a valid issuer by the staff console's own rule, with an ABN", () => {
    expect(invoiceIssuerSettingSchema.safeParse(DEMO_INVOICE_ISSUER).success).toBe(true);
    expect(DEMO_INVOICE_ISSUER.abn).not.toBeNull();
  });

  it("seeds the demo issuer with its ABN, and does nothing the second time", async () => {
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("seeded");
    const before = await approvedIssuers();
    expect(before).toEqual([{ set_by: "seed-demo", abn: "99000000032" }]);
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("present");
    expect(await approvedIssuers()).toEqual(before);
  });

  it("upgrades its own earlier demo row (no ABN) with a new row, keeping the history", async () => {
    await insertIssuer("seed-demo", {
      legalName: "YourTal Demo Pty Ltd",
      abn: null,
      address: "Demo address only, Sydney NSW 2000",
      email: "billing@demo.yourtal.example",
    });
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("upgraded");
    expect(await approvedIssuers()).toEqual([
      { set_by: "seed-demo", abn: null },
      { set_by: "seed-demo", abn: "99000000032" },
    ]);
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("present");
  });

  it("never overrides an issuer a person approved, even one without an ABN", async () => {
    await insertIssuer("staff-finance", {
      legalName: "A Real Company Pty Ltd",
      abn: null,
      address: "1 Real Street, Sydney NSW 2000",
      email: "billing@real.example",
    });
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("present");
    expect(await approvedIssuers()).toEqual([{ set_by: "staff-finance", abn: null }]);
  });
});

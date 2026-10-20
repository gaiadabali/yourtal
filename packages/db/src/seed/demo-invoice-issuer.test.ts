import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "../database-urls";
import { ensureDemoInvoiceIssuer } from "./demo-invoice-issuer";

/** The demo issuer seed against real Postgres: idempotent, and never over a person's approval. */
const { Pool } = pg;
let owner: pg.Pool;
const quiet = () => undefined;

beforeAll(() => {
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
});

async function approvedIssuers(): Promise<{ set_by: string; abn: string | null }[]> {
  const { rows } = await owner.query<{ set_by: string; abn: string | null }>(
    `SELECT set_by, value->>'abn' AS abn FROM platform.region_setting
      WHERE region = 'AU' AND key = 'invoice_issuer' AND approved_by IS NOT NULL
      ORDER BY effective_from`,
  );
  return rows;
}

describe("ensureDemoInvoiceIssuer", () => {
  it("leaves a demo issuer with no ABN, and does nothing the second time", async () => {
    await ensureDemoInvoiceIssuer(owner, quiet);
    const before = await approvedIssuers();
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(await ensureDemoInvoiceIssuer(owner, quiet)).toBe("present");
    expect(await approvedIssuers()).toEqual(before);
    expect(before[0]).toEqual({ set_by: "seed-demo", abn: null });
  });
});

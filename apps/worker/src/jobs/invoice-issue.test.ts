import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  seedBoostBatch,
  seedBusiness,
  seedCardPurchase,
  seedManualPurchase,
  setIssuer,
} from "@yourtal/db/invoicing/fixtures";
import { job, runInvoiceIssue } from "./invoice-issue";

/** 5.3: the invoice-issue job against real Postgres. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });
const quiet = () => undefined;

beforeAll(async () => {
  await setIssuer(pool, null);
});
afterAll(async () => {
  await setIssuer(pool, null);
  await pool.end();
});

async function invoiceCount(businessId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM invoice.invoice WHERE business_id = $1`,
    [businessId],
  );
  return Number(rows[0]?.count);
}

describe("invoice-issue", () => {
  it("runs every five minutes", () => {
    expect(job.queue).toBe("invoice.issue");
    expect(job.schedule).toBe("*/5 * * * *");
  });

  it("invoices each kind of paid source exactly once, and a re-run issues nothing new", async () => {
    const buyer = await seedBusiness(pool);
    await seedCardPurchase(pool, buyer.id);
    await seedBoostBatch(pool, buyer.id, { firstDay: "2026-10-01", lastDay: "2026-10-02" });
    await seedManualPurchase(pool, buyer.id);

    const first = await runInvoiceIssue(pool, quiet);
    expect(first.failed).toBe(0);
    expect(first.issued).toBeGreaterThanOrEqual(3);
    expect(await invoiceCount(buyer.id)).toBe(3);

    const second = await runInvoiceIssue(pool, quiet);
    // Sources other suites left (a batch whose business does not exist) may wait; nothing new is issued.
    expect(second).toMatchObject({ issued: 0, alreadyIssued: 0, failed: 0 });
    expect(await invoiceCount(buyer.id)).toBe(3);
  });

  it("leaves a pending purchase and an Indonesian one alone", async () => {
    const au = await seedBusiness(pool);
    const id = await seedBusiness(pool, { region: "ID" });
    await seedCardPurchase(pool, au.id, { status: "pending" });
    await seedCardPurchase(pool, id.id, {
      region: "ID",
      money: { subtotalMinor: 90_000, taxMinor: 0 },
    });

    await runInvoiceIssue(pool, quiet);
    expect(await invoiceCount(au.id)).toBe(0);
    expect(await invoiceCount(id.id)).toBe(0);
  });

  it("does not let 201 unissuable sources keep a good one waiting", async () => {
    // Paid, but their business does not exist: they can never be invoiced.
    for (let i = 0; i < 201; i += 1) await seedCardPurchase(pool, randomUUID());
    const buyer = await seedBusiness(pool);
    const good = await seedCardPurchase(pool, buyer.id);

    // The oldest 200 fill the first batch and are remembered as skipped...
    await runInvoiceIssue(pool, quiet);
    // ...so the next batch moves on past them to the good one.
    await runInvoiceIssue(pool, quiet);
    await runInvoiceIssue(pool, quiet);
    expect(await invoiceCount(buyer.id)).toBe(1);
    const { rows } = await pool.query(
      `SELECT 1 FROM invoice.invoice WHERE source_kind = 'card_purchase' AND source_id = $1`,
      [good.id],
    );
    expect(rows).toHaveLength(1);
    const skipped = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM invoice.issue_skip WHERE reason = 'buyer_not_found'`,
    );
    expect(Number(skipped.rows[0]?.count)).toBeGreaterThanOrEqual(201);
  });

  it("waits, then issues once the company's details are approved", async () => {
    const buyer = await seedBusiness(pool);
    await seedCardPurchase(pool, buyer.id);
    await pool.query(
      `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
       VALUES ('AU', 'invoice_issuer', '{}'::jsonb, 'test-a', 'test-b', clock_timestamp())`,
    );
    const messages: string[] = [];
    const waiting = await runInvoiceIssue(pool, (message) => messages.push(message));
    expect(waiting.skipped).toBeGreaterThanOrEqual(1);
    expect(messages.join("\n")).toContain("issuer_not_configured");
    expect(await invoiceCount(buyer.id)).toBe(0);

    await setIssuer(pool, null);
    await runInvoiceIssue(pool, quiet);
    expect(await invoiceCount(buyer.id)).toBe(1);
  });
});

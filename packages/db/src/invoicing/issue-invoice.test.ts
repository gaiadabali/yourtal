import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { isValidAbn } from "@yourtal/contracts/invoice/abn";
import { APP_URL, OWNER_URL } from "../database-urls";
import { issueInvoice } from "./issue-invoice";
import { findUninvoiced } from "./sources";
import {
  VALID_ABN,
  seedBoostBatch,
  seedBusiness,
  seedCardPurchase,
  seedManualPurchase,
  setIssuer,
} from "./invoice-fixtures";

/** 5.3: the invoice mechanism against real Postgres, as the application role. */
const { Pool } = pg;
let app: pg.Pool;
let owner: pg.Pool;

beforeAll(() => {
  app = new Pool({ connectionString: APP_URL, max: 12 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});
afterAll(async () => {
  await setIssuer(app, null);
  await app.end();
  await owner.end();
});
beforeEach(async () => {
  await setIssuer(app, null);
});

async function lastNumber(): Promise<number> {
  const { rows } = await app.query<{ last_number: string }>(
    `SELECT last_number::text FROM invoice.counter WHERE region = 'AU'`,
  );
  return Number(rows[0]?.last_number);
}

interface InvoiceFacts {
  number: string;
  region: string;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
  tax_rate_bps: number;
  currency: string;
  is_tax_invoice: boolean;
  issuer_abn: string | null;
  issuer_legal_name: string;
  buyer_legal_name: string;
  buyer_abn: string | null;
  payment_ref: string | null;
}

async function invoiceFor(kind: string, sourceId: string): Promise<InvoiceFacts> {
  const { rows } = await app.query<InvoiceFacts>(
    `SELECT * FROM invoice.invoice WHERE source_kind = $1 AND source_id = $2`,
    [kind, sourceId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no invoice for ${kind} ${sourceId}`);
  return row;
}

async function lines(kind: string, sourceId: string) {
  const { rows } = await app.query<{
    position: number;
    description: string;
    quantity: string;
    unit_minor: string;
    subtotal_minor: string;
    tax_minor: string;
  }>(
    `SELECT l.* FROM invoice.line l JOIN invoice.invoice i ON i.id = l.invoice_id
      WHERE i.source_kind = $1 AND i.source_id = $2 ORDER BY l.position`,
    [kind, sourceId],
  );
  return rows;
}

describe("numbering", () => {
  it("is gapless and unique when many invoices are issued at once", async () => {
    const buyer = await seedBusiness(app);
    const sources = await Promise.all(
      Array.from({ length: 16 }, () => seedCardPurchase(app, buyer.id)),
    );
    const before = await lastNumber();

    const outcomes = await Promise.all(
      sources.map((source) => issueInvoice(app, { kind: "card_purchase", id: source.id })),
    );

    const numbers = outcomes.map((outcome) => {
      expect(outcome.status).toBe("issued");
      return outcome.status === "issued" ? outcome.number : "";
    });
    expect(new Set(numbers).size).toBe(16);
    const expected = Array.from(
      { length: 16 },
      (_, i) => `YT-AU-${String(before + 1 + i).padStart(6, "0")}`,
    );
    expect([...numbers].sort()).toEqual(expected);
    expect(await lastNumber()).toBe(before + 16);
  });

  it("gives the same source one invoice when it is issued by many callers at once", async () => {
    const buyer = await seedBusiness(app);
    const source = await seedCardPurchase(app, buyer.id);
    const before = await lastNumber();

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => issueInvoice(app, { kind: "card_purchase", id: source.id })),
    );

    expect(outcomes.filter((outcome) => outcome.status === "issued")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "exists")).toHaveLength(7);
    expect(await lastNumber()).toBe(before + 1);
    const { rows } = await app.query(
      `SELECT 1 FROM invoice.invoice WHERE source_kind = 'card_purchase' AND source_id = $1`,
      [source.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("gives a number back when the issue fails, so none is skipped", async () => {
    const buyer = await seedBusiness(app);
    const broken = await seedCardPurchase(app, buyer.id);
    const before = await lastNumber();

    // A failure after the counter moved and the invoice row went in: the last step, its line.
    await owner.query(`CREATE FUNCTION invoice.test_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'line refused'; END; $$ LANGUAGE plpgsql`);
    await owner.query(`CREATE TRIGGER test_fail BEFORE INSERT ON invoice.line
      FOR EACH ROW EXECUTE FUNCTION invoice.test_fail()`);
    try {
      await expect(issueInvoice(app, { kind: "card_purchase", id: broken.id })).rejects.toThrow(
        /line refused/,
      );
    } finally {
      await owner.query(`DROP TRIGGER test_fail ON invoice.line`);
      await owner.query(`DROP FUNCTION invoice.test_fail()`);
    }
    expect(await lastNumber()).toBe(before);
    const { rows } = await app.query(`SELECT 1 FROM invoice.invoice WHERE source_id = $1`, [
      broken.id,
    ]);
    expect(rows).toHaveLength(0);

    const good = await seedCardPurchase(app, buyer.id);
    const outcome = await issueInvoice(app, { kind: "card_purchase", id: good.id });
    expect(outcome).toMatchObject({
      status: "issued",
      number: `YT-AU-${String(before + 1).padStart(6, "0")}`,
    });
  });
});

describe("each source kind", () => {
  it("invoices a paid card purchase once, with the amounts the purchase holds", async () => {
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id, {
      points: 50_000,
      money: { subtotalMinor: 225_000, taxMinor: 22_500 },
    });
    const first = await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    const again = await issueInvoice(app, { kind: "card_purchase", id: purchase.id });

    expect(first.status).toBe("issued");
    expect(again).toMatchObject({ status: "exists" });
    const invoice = await invoiceFor("card_purchase", purchase.id);
    expect(Number(invoice.subtotal_minor)).toBe(225_000);
    expect(Number(invoice.tax_minor)).toBe(22_500);
    expect(Number(invoice.total_minor)).toBe(247_500);
    expect(invoice.tax_rate_bps).toBe(1_000);
    expect(invoice.currency).toBe("AUD");
    expect(invoice.payment_ref).toBe(purchase.paymentRef);
    expect(invoice.buyer_legal_name).toBe(buyer.legalName);
    expect(await lines("card_purchase", purchase.id)).toMatchObject([
      {
        position: 1,
        description: "50,000 YourTal points",
        quantity: "1",
        unit_minor: "225000",
        subtotal_minor: "225000",
        tax_minor: "22500",
      },
    ]);
  });

  it("words a receipt package's line for receipt rewards, with the real point count", async () => {
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id, {
      points: 10_000,
      programme: "receipts",
      money: { subtotalMinor: 30_000, taxMinor: 3_000 },
    });
    await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    expect(await lines("card_purchase", purchase.id)).toMatchObject([
      { description: "10,000 YourTal points for receipt rewards", subtotal_minor: "30000" },
    ]);
  });

  it("invoices a charged boost batch, naming the campaign and the days", async () => {
    const buyer = await seedBusiness(app);
    const batch = await seedBoostBatch(app, buyer.id, {
      firstDay: "2026-10-03",
      lastDay: "2026-10-05",
      money: { subtotalMinor: 1_234, taxMinor: 123 },
      title: "Spring menu launch",
    });
    await issueInvoice(app, { kind: "boost_batch", id: batch.id });

    const invoice = await invoiceFor("boost_batch", batch.id);
    expect([
      Number(invoice.subtotal_minor),
      Number(invoice.tax_minor),
      Number(invoice.total_minor),
    ]).toEqual([1_234, 123, 1_357]);
    const [line] = await lines("boost_batch", batch.id);
    expect(line?.description).toBe(
      'Boost for the campaign "Spring menu launch", from 3 Oct 2026 to 5 Oct 2026',
    );
  });

  it("invoices a manual purchase: paidMinor is the ex-GST subtotal and GST is added at the region rate", async () => {
    const buyer = await seedBusiness(app);
    const proposal = await seedManualPurchase(app, buyer.id, {
      paidMinor: 333_333,
      points: 80_000,
    });
    await issueInvoice(app, { kind: "manual_purchase", id: proposal.id });

    const invoice = await invoiceFor("manual_purchase", proposal.id);
    expect(Number(invoice.subtotal_minor)).toBe(333_333);
    expect(Number(invoice.tax_minor)).toBe(33_333); // 33,333.3 rounds down
    expect(Number(invoice.total_minor)).toBe(366_666);
    expect(invoice.tax_rate_bps).toBe(1_000);
    expect(invoice.payment_ref).toBe(proposal.bankReference);
    expect((await lines("manual_purchase", proposal.id))[0]?.description).toBe(
      "80,000 YourTal points",
    );
  });

  it("skips a purchase that is not paid, and a source that does not exist", async () => {
    const buyer = await seedBusiness(app);
    const pending = await seedCardPurchase(app, buyer.id, { status: "pending" });
    expect(await issueInvoice(app, { kind: "card_purchase", id: pending.id })).toEqual({
      status: "skipped",
      reason: "not_paid",
      region: null,
    });
    expect(
      await issueInvoice(app, {
        kind: "card_purchase",
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ status: "skipped", reason: "source_not_found", region: null });
  });

  it("skips a manual purchase whose currency is not its region's", async () => {
    const buyer = await seedBusiness(app);
    const odd = await seedManualPurchase(app, buyer.id, { currency: "IDR" });
    expect(await issueInvoice(app, { kind: "manual_purchase", id: odd.id })).toEqual({
      status: "skipped",
      reason: "source_invalid",
      region: null,
    });
    await owner.query(`DELETE FROM staff.economy_proposal WHERE id = $1`, [odd.id]);
  });

  it("skips Indonesian sources: ID issues no invoices while it is a demo", async () => {
    const buyer = await seedBusiness(app, { region: "ID" });
    const purchase = await seedCardPurchase(app, buyer.id, {
      region: "ID",
      money: { subtotalMinor: 90_000, taxMinor: 0 },
    });
    expect(await issueInvoice(app, { kind: "card_purchase", id: purchase.id })).toEqual({
      status: "skipped",
      reason: "region_not_invoiced",
      region: "ID",
    });
    const pending = await findUninvoiced(app, 10_000);
    expect(pending.map((source) => source.id)).not.toContain(purchase.id);
  });
});

async function skipRows(sourceId: string) {
  const { rows } = await app.query<{ reason: string; region: string | null }>(
    `SELECT reason, region FROM invoice.issue_skip WHERE source_id = $1`,
    [sourceId],
  );
  return rows;
}

describe("the finder", () => {
  it("remembers a source it could not invoice and leaves it out for the cooldown", async () => {
    // Paid, but its business does not exist: it can never be invoiced.
    const orphan = await seedCardPurchase(app, randomUUID());
    expect(await issueInvoice(app, { kind: "card_purchase", id: orphan.id })).toEqual({
      status: "skipped",
      reason: "buyer_not_found",
      region: "AU",
    });
    expect(await skipRows(orphan.id)).toEqual([{ reason: "buyer_not_found", region: "AU" }]);

    expect((await findUninvoiced(app, 10_000)).map((source) => source.id)).not.toContain(orphan.id);
    // With no cooldown it is a candidate again.
    expect((await findUninvoiced(app, 10_000, 0)).map((source) => source.id)).toContain(orphan.id);
    // Trying again updates the one row rather than adding another.
    await issueInvoice(app, { kind: "card_purchase", id: orphan.id });
    expect(await skipRows(orphan.id)).toHaveLength(1);
  });

  it("lists paid AU sources with no invoice, and nothing once they are invoiced", async () => {
    const buyer = await seedBusiness(app);
    const card = await seedCardPurchase(app, buyer.id);
    const batch = await seedBoostBatch(app, buyer.id, {
      firstDay: "2026-10-01",
      lastDay: "2026-10-01",
    });
    const manual = await seedManualPurchase(app, buyer.id);
    const mine = new Set([card.id, batch.id, manual.id]);

    const found = await findUninvoiced(app, 10_000);
    expect(
      found
        .filter((source) => mine.has(source.id))
        .map((source) => source.kind)
        .sort(),
    ).toEqual(["boost_batch", "card_purchase", "manual_purchase"]);

    for (const source of found) await issueInvoice(app, source);
    const left = await findUninvoiced(app, 10_000);
    expect(left.filter((source) => mine.has(source.id))).toEqual([]);
  });
});

describe("Tax invoice or Invoice", () => {
  it("is a plain invoice while the issuer has no ABN", async () => {
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id);
    await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    const invoice = await invoiceFor("card_purchase", purchase.id);
    expect(invoice.is_tax_invoice).toBe(false);
    expect(invoice.issuer_abn).toBeNull();
  });

  it("is a tax invoice when the issuer's ABN is set and valid, snapshotting the issuer", async () => {
    expect(isValidAbn(VALID_ABN)).toBe(true);
    await setIssuer(app, "51 824 753 556", "YourTal Pty Ltd");
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id);
    await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    const invoice = await invoiceFor("card_purchase", purchase.id);
    expect(invoice.is_tax_invoice).toBe(true);
    expect(invoice.issuer_abn).toBe(VALID_ABN);
    expect(invoice.issuer_legal_name).toBe("YourTal Pty Ltd");

    // Changing the company afterwards never rewrites an issued invoice.
    await setIssuer(app, null, "Somebody Else Pty Ltd");
    expect((await invoiceFor("card_purchase", purchase.id)).issuer_legal_name).toBe(
      "YourTal Pty Ltd",
    );
  });

  it("is a plain invoice when the ABN fails its checksum, and does not print it", async () => {
    expect(isValidAbn("12345678901")).toBe(false);
    await setIssuer(app, "12345678901");
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id);
    await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    const invoice = await invoiceFor("card_purchase", purchase.id);
    expect(invoice.is_tax_invoice).toBe(false);
    expect(invoice.issuer_abn).toBeNull();
  });

  it("waits, issuing nothing, when the issuer's details are missing", async () => {
    await app.query(
      `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
       VALUES ('AU', 'invoice_issuer', '{"legalName": ""}'::jsonb, 'test-a', 'test-b', clock_timestamp())`,
    );
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id);
    const before = await lastNumber();
    expect(await issueInvoice(app, { kind: "card_purchase", id: purchase.id })).toEqual({
      status: "skipped",
      reason: "issuer_not_configured",
      region: "AU",
    });
    expect(await lastNumber()).toBe(before);
    // A whole-region wait is not remembered per source: the next run tries it again.
    expect(await skipRows(purchase.id)).toEqual([]);
    expect((await findUninvoiced(app, 10_000)).map((source) => source.id)).toContain(purchase.id);
  });
});

describe("the buyer", () => {
  it("carries the business's legal name, and its ABN only when it holds a valid one", async () => {
    const withAbn = await seedBusiness(app, { abn: VALID_ABN });
    const without = await seedBusiness(app); // the onboarding placeholder 00000000000 fails the checksum
    const a = await seedCardPurchase(app, withAbn.id);
    const b = await seedCardPurchase(app, without.id);
    await issueInvoice(app, { kind: "card_purchase", id: a.id });
    await issueInvoice(app, { kind: "card_purchase", id: b.id });

    expect(await invoiceFor("card_purchase", a.id)).toMatchObject({
      buyer_legal_name: withAbn.legalName,
      buyer_abn: VALID_ABN,
    });
    expect(await invoiceFor("card_purchase", b.id)).toMatchObject({
      buyer_legal_name: without.legalName,
      buyer_abn: null,
    });
  });

  it("is named on a tax invoice of A$1,000 or more, ABN or not", async () => {
    await setIssuer(app, VALID_ABN);
    const buyer = await seedBusiness(app);
    const big = await seedCardPurchase(app, buyer.id, {
      money: { subtotalMinor: 1_000_000, taxMinor: 100_000 },
    });
    await issueInvoice(app, { kind: "card_purchase", id: big.id });
    const invoice = await invoiceFor("card_purchase", big.id);
    expect(Number(invoice.total_minor)).toBeGreaterThanOrEqual(100_000);
    expect(invoice).toMatchObject({ is_tax_invoice: true, buyer_legal_name: buyer.legalName });
  });
});

describe("an issued invoice", () => {
  it("can never be changed or deleted, even by the owner", async () => {
    const buyer = await seedBusiness(app);
    const purchase = await seedCardPurchase(app, buyer.id);
    await issueInvoice(app, { kind: "card_purchase", id: purchase.id });
    await expect(
      owner.query(`UPDATE invoice.invoice SET total_minor = 1 WHERE source_id = $1`, [purchase.id]),
    ).rejects.toThrow(/never changed or deleted/);
    await expect(
      owner.query(
        `DELETE FROM invoice.line WHERE invoice_id IN
                     (SELECT id FROM invoice.invoice WHERE source_id = $1)`,
        [purchase.id],
      ),
    ).rejects.toThrow(/never changed or deleted/);
    // The application role has no UPDATE or DELETE at all.
    await expect(
      app.query(`UPDATE invoice.invoice SET payment_ref = 'x' WHERE source_id = $1`, [purchase.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a total that is not subtotal plus GST, and a tax invoice with no ABN", async () => {
    const buyer = await seedBusiness(app);
    const insert = (total: number, isTax: boolean, abn: string | null) =>
      owner.query(
        `INSERT INTO invoice.invoice (region, seq, number, business_id, source_kind, source_id, currency,
           subtotal_minor, tax_minor, total_minor, tax_rate_bps, issuer_legal_name, issuer_abn,
           issuer_address, issuer_email, buyer_legal_name, is_tax_invoice)
         VALUES ('AU', 900000001, 'YT-AU-900000001', $1, 'card_purchase', gen_random_uuid(), 'AUD',
                 100, 10, $2, 1000, 'x', $3, 'x', 'x', 'x', $4)`,
        [buyer.id, total, abn, isTax],
      );
    await expect(insert(111, false, null)).rejects.toThrow(/invoice_total/);
    await expect(insert(110, true, null)).rejects.toThrow(/invoice_tax_needs_abn/);
  });
});

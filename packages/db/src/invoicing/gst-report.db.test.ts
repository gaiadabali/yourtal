import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL } from "../database-urls";
import { buildGstReportCsv, loadGstReportRows, totalsOf } from "./gst-report";
import { issueInvoice } from "./issue-invoice";
import {
  VALID_ABN,
  seedBoostBatch,
  seedBusiness,
  seedCardPurchase,
  setIssuer,
} from "./invoice-fixtures";

/** 6.12.a: the report's rows read from real invoices, as the application role. */
const { Pool } = pg;
let app: pg.Pool;

beforeAll(async () => {
  app = new Pool({ connectionString: APP_URL, max: 4 });
  await setIssuer(app, VALID_ABN);
});
afterAll(async () => {
  await setIssuer(app, null);
  await app.end();
});

describe("loadGstReportRows", () => {
  it("returns this period's AU invoices with their own amounts and kinds, and leaves other days out", async () => {
    const buyer = await seedBusiness(app, { abn: VALID_ABN });
    const points = await seedCardPurchase(app, buyer.id);
    const receipts = await seedCardPurchase(app, buyer.id, { programme: "receipts" });
    const boost = await seedBoostBatch(app, buyer.id, {
      firstDay: new Date().toISOString().slice(0, 10),
      lastDay: new Date().toISOString().slice(0, 10),
    });
    for (const [kind, id] of [
      ["card_purchase", points.id],
      ["card_purchase", receipts.id],
      ["boost_batch", boost.id],
    ] as const) {
      expect((await issueInvoice(app, { kind, id })).status).toBe("issued");
    }

    // Australian time can be a day ahead of UTC, so the range spans both.
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const period = { from: day(-1), to: day(1), label: "today" };
    const rows = (await loadGstReportRows(app, period)).filter(
      (row) => row.business === buyer.legalName,
    );
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "boost",
      "points_package",
      "receipt_package",
    ]);
    expect(
      rows.every((row) => row.documentType === "invoice" && row.businessAbn === VALID_ABN),
    ).toBe(true);
    const pointsRow = rows.find((row) => row.kind === "points_package");
    expect(pointsRow).toMatchObject({ netMinor: points.subtotalMinor, gstMinor: points.taxMinor });

    const totals = totalsOf(rows);
    expect(totals.gstCollectedMinor).toBe(rows.reduce((sum, row) => sum + row.gstMinor, 0));
    expect(buildGstReportCsv(period, rows)).toContain(
      `gst_collected_minor,${String(totals.gstCollectedMinor)}`,
    );

    const longAgo = await loadGstReportRows(app, {
      from: "2001-01-01",
      to: "2001-03-31",
      label: "2001-Q1",
    });
    expect(longAgo).toEqual([]);
  });
});

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { REGIONS, useSession, type RegionCase } from "./demo";
import { closeDb, db, demoBusinessId, demoCaller, msg, one, requireBusinessEnv } from "./business";

const POINTS = 50_000;
const DRAWN = 1_200;

/**
 * Journey 2 (product-intent §2.2): Finance buys a block of points in Studio
 * Billing through the simulated payment driver. The cash posts to the
 * region's segregated reserve, an allocation is created from that purchase,
 * and Billing shows the purchase, its drawdown and the remainder. Checks the
 * purchase, allocation and reserve posting rows, and that a marketer cannot
 * buy.
 */
test.afterAll(closeDb);

/** Draws points from an allocation the way a completion grant does (hold, then consume). */
async function drawDown(allocationId: string, points: number, r: RegionCase) {
  const base = process.env["LEDGER_BASE_URL"] ?? "http://127.0.0.1:26910";
  const secret =
    process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real";
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const payload = JSON.stringify(body);
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yourtal-region": r.region,
        [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
          secret,
          caller: "api",
          method: "POST",
          pathAndQuery: path,
          body: payload,
        }),
      },
      body: payload,
    });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBeTruthy();
    return (await response.json()) as T;
  };
  const hold = await post<{ holdId: string }>("/v1/allocations/hold", {
    allocationId,
    points,
    sagaId: `j02-${randomUUID()}`,
  });
  await post("/v1/allocations/hold/consume", { holdId: hold.holdId });
}

for (const r of REGIONS) {
  test(`J2 ${r.region}: Finance buys points; Billing shows the purchase, drawdown and remainder`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    requireBusinessEnv();
    const finance = await demoCaller(request, "finance", r);
    const businessId = await demoBusinessId(finance);
    const currency = r.region === "AU" ? "AUD" : "IDR";
    const quote = await finance.get<{ totalMinor: number; currency: string }>(
      `/api/${businessId}/studio/billing/purchases/quote?points=${POINTS}`,
    );
    expect(quote.currency).toBe(currency);
    const { rows: before } = await db().query<{ id: string }>(
      `SELECT id FROM ledger.point_purchase WHERE partner_id = $1`,
      [businessId],
    );

    // Finance buys the first preset block in Studio Billing.
    await useSession(page.context(), baseURL!, finance.token, r);
    await page.goto(`/studio/billing?business=${businessId}`);
    await page
      .getByRole("button", { name: msg(r, "studio", "billing.buy") })
      .first()
      .click();
    await page.waitForURL(/purchased=1|error=/);
    // Either way the person stays on this business's Billing and is told what happened.
    expect(new URL(page.url()).searchParams.get("business")).toBe(businessId);
    if (page.url().includes("error=")) {
      await expect(page.getByText(msg(r, "studio", "billing.purchaseFailed"))).toBeVisible();
    }
    await expect(page).toHaveURL(/purchased=1/);
    await expect(page.getByText(msg(r, "studio", "billing.purchased"))).toBeVisible();

    // One new purchase: the points, the server's price, the cash in this region's reserve.
    const purchase = await one<{
      points: string;
      amount: string;
      currency: string;
      allocation_id: string;
      cash_transfer_id: string;
    }>(
      `SELECT points::text, amount_minor::text AS amount, currency, allocation_id, cash_transfer_id
         FROM ledger.point_purchase WHERE partner_id = $1 AND NOT (id = ANY($2::text[]))`,
      [businessId, before.map((row) => row.id)],
    );
    expect(purchase).toMatchObject({
      points: String(POINTS),
      amount: String(quote.totalMinor),
      currency,
    });
    const allocation = await one<{
      funder_type: string;
      region: string;
      total: string;
      left: string;
    }>(
      `SELECT funder_type, region, total_points::text AS total, remaining_points::text AS left
         FROM ledger.allocation WHERE id = $1 AND funder_id = $2`,
      [purchase.allocation_id, businessId],
    );
    expect(allocation).toEqual({
      funder_type: "partner",
      region: r.region,
      total: String(POINTS),
      left: String(POINTS),
    });
    const { rows: legs } = await db().query<{ account: string; amount: string; currency: string }>(
      `SELECT e.account_id AS account, e.amount_minor::text AS amount, e.currency
         FROM ledger.entry e WHERE e.transfer_id = $1 ORDER BY e.account_id`,
      [purchase.cash_transfer_id],
    );
    expect(legs).toEqual([
      { account: `plat_${r.region}_partner_funding`, amount: String(quote.totalMinor), currency },
      { account: `plat_${r.region}_reserve`, amount: String(-quote.totalMinor), currency },
    ]);
    const transfer = await one<{ reason_code: string }>(
      `SELECT reason_code FROM ledger.transfer WHERE id = $1`,
      [purchase.cash_transfer_id],
    );
    expect(transfer.reason_code).toBe("partner_point_purchase");

    // Billing lists the purchase, all of it still left.
    const n = new Intl.NumberFormat(r.locale);
    const row = page.getByRole("listitem").filter({
      hasText: msg(r, "studio", "billing.historyBought").replace("{formatted}", n.format(POINTS)),
    });
    await expect(row.first()).toBeVisible();

    // A campaign draws from it; Billing shows the drawdown and the remainder.
    await drawDown(purchase.allocation_id, DRAWN, r);
    const drawn = await one<{ left: string }>(
      `SELECT remaining_points::text AS left FROM ledger.allocation WHERE id = $1`,
      [purchase.allocation_id],
    );
    expect(drawn.left).toBe(String(POINTS - DRAWN));
    await page.reload();
    const after = page.getByRole("listitem").filter({
      hasText: msg(r, "studio", "billing.historyUsed").replace("{formatted}", n.format(DRAWN)),
    });
    await expect(after.first()).toBeVisible();
    await expect(
      after
        .first()
        .getByText(
          msg(r, "studio", "billing.historyLeft").replace("{formatted}", n.format(POINTS - DRAWN)),
        ),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/j02-billing-${r.slug}.png`, fullPage: true });

    // Buying is Finance's (and the owner's) job: a marketer is refused.
    const marketer = await demoCaller(request, "member", r);
    await marketer.post(
      `/api/${businessId}/studio/billing/purchases`,
      { points: POINTS, currency },
      403,
    );
  });
}

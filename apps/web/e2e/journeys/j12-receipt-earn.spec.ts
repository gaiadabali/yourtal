import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API, REGIONS, apiRegister, testIp, useSession } from "./demo";
import { callerFor, closeDb, db, requireBusinessEnv } from "./business";

/** F12: snap-app's receipt reward per region. */
const RECEIPT_POINTS = { AU: 10, ID: 100 } as const;

/**
 * Journey 12 (product-intent §2.2): the snap-app server calls the earn API
 * with a receipt, signed with its partner secret. The points are funded by
 * group marketing (K6), arrive pending, and one receipt earns once. Checks
 * the ledger grant row and its marketing-expense posting.
 */
test.afterAll(closeDb);

for (const r of REGIONS) {
  test(`J12 ${r.region}: a snap-app receipt earns marketing-funded points once`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    requireBusinessEnv();
    const secret = process.env["SNAP_APP_PARTNER_SECRET"] ?? "";
    expect(secret, "set SNAP_APP_PARTNER_SECRET (the api's own)").not.toBe("");
    const viewer = await apiRegister(request, r, "j12");
    const me = callerFor(request, viewer);

    // The viewer links snap-app with a one-time code from Me.
    const { code } = await me.post<{ code: string }>("/api/me/linked-apps/code", {});
    const before = await me.get<{ pendingPoints: number; availablePoints: number }>("/api/wallet");

    const externalRef = `receipt-${randomUUID()}`;
    const body = JSON.stringify({
      user: code,
      action: "receipt_scanned",
      externalRef,
      evidence: { ocr: r.region === "AU" ? "$4.50 flat white" : "Rp28.000 kopi susu" },
    });
    const signed = (raw: string) => ({
      authorization: `Partner snap-app:${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      "x-forwarded-for": testIp(),
    });
    const earned = await request.post(`${API}/api/partners/actions`, {
      headers: signed(body),
      data: body,
    });
    expect(earned.status(), await earned.text()).toBe(200);
    expect(await earned.json()).toEqual({ granted: true, points: RECEIPT_POINTS[r.region] });

    // The same receipt again (a new request) earns nothing.
    const again = await request.post(`${API}/api/partners/actions`, {
      headers: signed(body),
      data: body,
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: "duplicate_receipt" });

    // A forged signature is refused outright.
    const forged = await request.post(`${API}/api/partners/actions`, {
      headers: { ...signed(body), authorization: "Partner snap-app:deadbeef" },
      data: body,
    });
    expect(forged.status()).toBe(401);

    const after = await me.get<{ pendingPoints: number; availablePoints: number }>("/api/wallet");
    // Earned once: pending or, where its hold has already lapsed, available.
    const total = (w: { pendingPoints: number; availablePoints: number }) =>
      w.pendingPoints + w.availablePoints;
    expect(total(after) - total(before)).toBe(RECEIPT_POINTS[r.region]);

    // One grant, in this region, posted against the marketing expense (K6).
    const { rows: grants } = await db().query<{ points: string; region: string; tid: string }>(
      `SELECT points::text, region, transfer_id AS tid FROM ledger.grant
        WHERE user_id = $1 AND action_type = 'receipt_scanned'`,
      [viewer.userId],
    );
    expect(grants).toEqual([
      { points: String(RECEIPT_POINTS[r.region]), region: r.region, tid: expect.any(String) },
    ]);
    const { rows: legs } = await db().query<{ id: string; amount: string }>(
      `SELECT a.id, e.amount_minor::text AS amount FROM ledger.entry e
         JOIN ledger.account a ON a.id = e.account_id WHERE e.transfer_id = $1 ORDER BY a.id`,
      [grants[0]?.tid],
    );
    expect(legs.map((leg) => leg.id)).toContain(`plat_${r.region}_marketing_expense`);
    expect(legs.reduce((sum, leg) => sum + Number(leg.amount), 0)).toBe(0);

    // The wallet shows it as pending.
    await useSession(context, baseURL!, viewer.token, r);
    await page.goto("/wallet");
    await expect(page.getByText(String(total(after))).first()).toBeVisible();
  });
}

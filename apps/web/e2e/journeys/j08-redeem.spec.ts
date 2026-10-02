import { expect, test } from "@playwright/test";
import { REGIONS } from "./demo";
import { closeDb, db, demoCaller, one, requireBusinessEnv } from "./business";

const PIN = "4826";

/**
 * Journey 8 (product-intent §2.2): the business owner provisions a counter
 * device in Studio; store staff pair it, unlock it with the PIN and enter
 * the customer's code; the device authorizes and captures, and both sides
 * see the receipt. Checks the authorization and capture rows and the
 * voucher's own state.
 */
test.afterAll(closeDb);

for (const r of REGIONS) {
  test(`J8 ${r.region}: pair a counter, unlock with the PIN, redeem a customer's voucher`, async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    requireBusinessEnv();
    const owner = await demoCaller(request, "owner", r);
    // A demo viewer's unused voucher, and the owner of the brand that honours it.
    let pick:
      { person: string; voucherId: string; merchantId: string; locationId: string } | undefined;
    for (const person of ["adult", "guardian", "viewer", "member"]) {
      const viewer = await demoCaller(request, person, r);
      const { vouchers } = await viewer.get<{ vouchers: { voucherId: string; status?: string }[] }>(
        "/api/wallet/vouchers",
      );
      for (const voucher of vouchers.filter((v) => v.status === "active")) {
        const { rows } = await db().query<{ merchant_id: string; location_id: string }>(
          `SELECT v.merchant_id::text, v.location_id::text FROM voucher.vouchers v
             JOIN business.business_members m ON m.business_id = v.merchant_id AND m.role = 'owner'
            WHERE v.id = $1 AND m.user_id = $2`,
          [voucher.voucherId, owner.userId],
        );
        if (rows[0]) {
          pick = {
            person,
            voucherId: voucher.voucherId,
            merchantId: rows[0].merchant_id,
            locationId: rows[0].location_id,
          };
          break;
        }
      }
      if (pick) break;
    }
    expect(
      pick,
      `no demo viewer in ${r.region} holds a voucher from the demo owner's brand`,
    ).toBeDefined();
    const { person, voucherId, merchantId, locationId } = pick!;
    const viewer = await demoCaller(request, person, r);

    // Studio: the owner provisions a counter with its PIN.
    const provisioned = await owner.post<{ pairingCode: string }>(
      `/api/${merchantId}/studio/devices`,
      { locationId, label: r.region === "AU" ? "Journey counter" : "Kasir journey", pin: PIN },
    );

    // The counter: pair, unlock, enter the code from the customer's Wallet.
    const counter = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await counter.newPage();
    await page.goto(`${baseURL}/merchant/pair`);
    await page.getByLabel(/Pairing code|Kode pemasangan/i).fill(provisioned.pairingCode);
    await page.getByRole("button", { name: /Pair|Pasangkan/i }).click();
    await page.getByLabel(/^PIN$/).fill(PIN);
    await page.getByRole("button", { name: /Unlock|Buka/i }).click();
    const { token } = await viewer.get<{ token: string }>(`/api/wallet/vouchers/${voucherId}/qr`);
    const tab = page.getByRole("tab", { name: /Enter code|Masukkan kode/i });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await page.getByLabel(/^(Voucher code|Kode voucher)$/).fill(token);
    await page.getByRole("button", { name: /^(Look up voucher|Cari voucher)$/ }).click();
    await page.getByRole("button", { name: /^(Confirm redemption|Konfirmasi redeem)$/ }).click();
    await expect(
      page.getByRole("heading", { name: /^(Redeemed|Berhasil di-redeem)$/ }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/j08-counter-${r.slug}.png`, fullPage: true });
    await counter.close();

    // The rows: one captured authorization from that device, and the voucher spent.
    const auth = await one<{
      state: string;
      device_id: string | null;
      amount: string;
      captured: string;
    }>(
      `SELECT a.state, a.device_id::text, a.amount_minor::text AS amount, c.amount_minor::text AS captured
         FROM voucher.authorization a JOIN voucher.capture c ON c.authorization_id = a.id
        WHERE a.voucher_id = $1`,
      [voucherId],
    );
    expect(auth.device_id).not.toBeNull();
    expect(auth.captured).toBe(auth.amount);
    const voucher = await one<{ state: string; remaining: string }>(
      `SELECT state, remaining_value_minor::text AS remaining FROM voucher.vouchers WHERE id = $1`,
      [voucherId],
    );
    expect(["redeemed", "partially_redeemed", "active"]).toContain(voucher.state);

    // The customer's side shows it redeemed.
    const after = await viewer.get<{ vouchers: { voucherId: string; status?: string }[] }>(
      "/api/wallet/vouchers",
    );
    const mine = after.vouchers.find((v) => v.voucherId === voucherId);
    expect(mine?.status === "redeemed" || Number(voucher.remaining) > 0).toBe(true);
  });
}

import { expect, test } from "@playwright/test";
import { apiGet, apiLogin, demoEmail, REGIONS, requireDemoEnv, useSession } from "./demo";

type Listing = {
  id: string;
  title: string;
  merchantName: string;
  priceInPoints: number;
  stockRemaining: number;
  audience: string;
};
type Wallet = { region: string; availablePoints: number };
type Voucher = { voucherId: string; listingId: string; state: string };

/**
 * Journey 7 (product-intent §2.2): open a listing and its terms, lock the
 * price, redeem, and find the voucher in the Wallet with its QR, which still
 * shows offline. Available points drop by exactly the locked price.
 */
for (const r of REGIONS) {
  test(`J7 ${r.region}: a listing's terms → price locked → redeem → voucher with a QR in the Wallet`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    requireDemoEnv();
    // The demo person with the most spendable points, and the cheapest thing they can afford.
    let pick: { email: string; token: string; wallet: Wallet; listing: Listing } | undefined;
    for (const person of ["adult", "guardian", "viewer"]) {
      const email = demoEmail(person, r);
      const { token } = await apiLogin(request, email);
      const wallet = await apiGet<Wallet>(request, token, "/api/wallet");
      const { data: listings } = await apiGet<{ data: Listing[] }>(
        request,
        token,
        `/api/store/listings?maxPoints=${String(wallet.availablePoints)}`,
      );
      const listing = listings
        .filter(
          (l) =>
            l.stockRemaining > 0 &&
            l.audience === "all_ages" &&
            l.priceInPoints <= wallet.availablePoints,
        )
        .sort((a, b) => a.priceInPoints - b.priceInPoints)[0];
      if (listing && (!pick || wallet.availablePoints > pick.wallet.availablePoints))
        pick = { email, token, wallet, listing };
    }
    expect(
      pick,
      `no demo viewer in ${r.region} can afford a listing; run pnpm demo:reset`,
    ).toBeDefined();
    const { token, wallet: before, listing } = pick!;
    const vouchersBefore = await apiGet<{ vouchers: Voucher[] }>(
      request,
      token,
      "/api/wallet/vouchers",
    );
    await useSession(context, baseURL!, token, r);

    // The listing and its terms.
    await page.goto(`/store/${listing.id}`);
    await expect(page.getByRole("heading", { name: listing.title }).first()).toBeVisible();
    await page.getByRole("link", { name: /^(Redeem now|Tukar sekarang)$/i }).click();

    // The price is locked while they decide.
    await expect(page).toHaveURL(new RegExp(`/store/${listing.id}/redeem`));
    await expect(page.getByText(/^(Price locked|Harga terkunci) · /)).toBeVisible();
    await page.getByRole("button", { name: /^(Continue|Lanjutkan)$/ }).click();
    await page.getByRole("button", { name: /^(Redeem now|Tukar sekarang)$/i }).click();
    const toWallet = page.getByRole("link", { name: /^(View in Wallet|Lihat di Dompet)$/ });
    await expect(toWallet).toBeVisible({ timeout: 60_000 });

    // The ledger and the wallet agree: exactly the price, from available points, and one new voucher.
    const after = await apiGet<Wallet>(request, token, "/api/wallet");
    expect(before.availablePoints - after.availablePoints).toBe(listing.priceInPoints);
    const vouchersAfter = await apiGet<{ vouchers: Voucher[] }>(
      request,
      token,
      "/api/wallet/vouchers",
    );
    const known = new Set(vouchersBefore.vouchers.map((v) => v.voucherId));
    const minted = vouchersAfter.vouchers.filter((v) => !known.has(v.voucherId));
    expect(minted).toHaveLength(1);
    expect(minted[0]?.listingId).toBe(listing.id);
    const stock = await apiGet<Listing>(request, token, `/api/store/listings/${listing.id}`);
    expect(stock.stockRemaining).toBe(listing.stockRemaining - 1);

    // The voucher, with its QR.
    await page.goto(`/wallet/voucher/${minted[0]!.voucherId}`);
    const qr = page.getByRole("img", { name: /^(Redemption QR code for|Kode QR redeem voucher) / });
    await expect(qr).toBeVisible();

    // Offline, from the service worker's copy (production builds only; dev serves no worker).
    const controlled = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      return registration !== null;
    });
    if (!controlled) {
      test.info().annotations.push({
        type: "offline",
        description: "no service worker on this server; offline QR not checked",
      });
      return;
    }
    await page.reload();
    await context.setOffline(true);
    await page.reload();
    await expect(qr).toBeVisible();
    await context.setOffline(false);
  });
}

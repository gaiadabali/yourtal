import { expect, test } from "@playwright/test";
import { AFFORDABLE_LISTING_ID } from "./fixture-ids";

/**
 * YT-0450's first acceptance criterion, Spend leg: `/store` -> browse ->
 * an offer -> the burn flow -> price-lock countdown visible -> confirm ->
 * success. Unlike Earn, nothing here depends on real video playback, so
 * this journey is driven to genuine completion, real click by real click.
 *
 * `AFFORDABLE_LISTING_ID` (see fixture-ids.ts) was chosen by browsing
 * `/store` and finding a listing whose offer page actually renders an
 * enabled "Tukar Sekarang" button against the mock balance — most of the
 * catalogue is deliberately priced above or below afford-ability to
 * exercise those states elsewhere (`overflow-320.spec.ts` already covers
 * `LONG_MERCHANT_LISTING_ID`, which is deliberately unaffordable).
 */
test.describe("Spend journey", () => {
  test("store browse -> offer -> burn flow -> price lock -> confirm -> success, with the offer page's affordability verdict honoured all the way through", async ({
    page,
  }) => {
    await page.goto("/store");

    const cardLink = page.locator(`a[href="/store/${AFFORDABLE_LISTING_ID}"]`);
    await expect(cardLink, "the fixture listing must be on the store grid").toBeVisible();
    const cardTitle = (await cardLink.textContent())?.trim();
    expect(cardTitle).toBeTruthy();

    // Real click from the browse grid, not page.goto.
    await cardLink.click();
    await expect(page).toHaveURL(`/store/${AFFORDABLE_LISTING_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(cardTitle!);

    // The offer page's own affordability verdict — this is the seam
    // `store-burn-agreement.test.ts` checks at the unit level. If this
    // button were disabled ("Poin belum cukup"/"Stok habis"), the fixture
    // choice above would be wrong; asserting it here is what makes that
    // failure mode visible instead of silently clicking a disabled button.
    const redeemButton = page.getByRole("link", { name: "Tukar Sekarang" });
    await expect(redeemButton).toBeVisible();

    await redeemButton.click();
    await expect(page).toHaveURL(`/store/${AFFORDABLE_LISTING_ID}/redeem`);

    // The burn flow's own honoured-terms rule (YT-0422): the review step
    // must restate the same listing, not a re-derived approximation.
    await expect(page.getByText(cardTitle!).first()).toBeVisible();

    // First acceptance detail: the price-lock countdown is visible from the
    // moment the price is first shown, before any commitment.
    const countdown = page.getByRole("timer");
    await expect(countdown).toBeVisible();
    await expect(countdown).toHaveAttribute("aria-label", /Harga terkunci, sisa waktu/);

    await page.getByRole("button", { name: "Lanjutkan" }).click();

    // Confirmation restates the same terms again (second acceptance
    // detail) and the countdown is still visible and still running.
    await expect(page.getByText(cardTitle!).first()).toBeVisible();
    await expect(countdown).toBeVisible();

    await page.getByRole("button", { name: "Tukar sekarang" }).click();

    // Success state: a real voucher code, and a real link into the wallet
    // where that same voucher must actually appear (the Redeem journey's
    // starting point).
    await expect(page.getByText("Berhasil", { exact: true })).toBeVisible();
    await expect(page.getByText(/berhasil ditukar/)).toBeVisible();
    await expect(page.getByText("Kode voucher Anda:")).toBeVisible();
    const walletLink = page.getByRole("link", { name: "Lihat di Dompet" });
    await expect(walletLink).toBeVisible();
    await expect(walletLink).toHaveAttribute("href", "/wallet");
  });
});

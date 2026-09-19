import { expect, test } from "@playwright/test";
import { mockListings } from "@yourtal/contracts/listing/mock";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";

/**
 * `burn-redemption.ts`'s `attemptBurn` deterministically simulates the
 * merchant/network failing to honour roughly one listing in eight
 * (`isSimulatedMerchantFailure`, hashed from the listing id, never
 * random). This journey exists to prove the HAPPY path completes —
 * `redeem-journey.spec.ts` already exercises a `network_error` retry loop
 * for the sibling case in the merchant redemption flow — so a listing
 * landing in that bucket is excluded here by reproducing the exact same
 * hash rather than accepting an intermittent failure the suite has no way
 * to explain when it lands.
 */
function isSimulatedMerchantFailure(listingId: string): boolean {
  return hashStringToSeed(`${listingId}:redemption-outcome`) % 8 === 0;
}

/**
 * YT-0450's first acceptance criterion, Spend leg: `/store` -> browse ->
 * an offer -> the burn flow -> price-lock countdown visible -> confirm ->
 * success. Unlike Earn, nothing here depends on real video playback, so
 * this journey is driven to genuine completion, real click by real click.
 *
 * The affordable listing is SELECTED, not pinned: `mixedStateBalanceFixture`
 * (8,400 available points) is the one balance the app's mock data layer
 * ever serves (`store-balance-data.ts`, `wallet-data.ts`), so any in-stock
 * listing priced at or below it will genuinely render an enabled "Tukar
 * Sekarang" button. Picking by that property means a change to the listing
 * generator's draw order can shuffle which listing this is without ever
 * breaking the test — most of the catalogue is deliberately priced above or
 * below afford-ability to exercise those states elsewhere
 * (`overflow-320.spec.ts` already covers the always-unaffordable
 * `abovePlausibleBalanceListingFixture`).
 */
const affordableListing = mockListings.find(
  (candidate) =>
    candidate.status !== "sold_out" &&
    candidate.priceInPoints <= mixedStateBalanceFixture.availablePoints &&
    !isSimulatedMerchantFailure(candidate.id),
);
if (!affordableListing) {
  throw new Error(
    "expected at least one in-stock, affordable listing outside the simulated-failure bucket in mockListings — the store's own happy path would have nothing to demonstrate either",
  );
}
const AFFORDABLE_LISTING_ID = affordableListing.id;
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

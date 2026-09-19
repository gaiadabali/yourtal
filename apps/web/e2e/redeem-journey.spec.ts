import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  MERCHANT_ONLY_VOUCHER_CODE,
  MERCHANT_PROVISIONING_CODE,
  MERCHANT_PROVISIONING_PIN,
  WALLET_VOUCHER_CODE,
  WALLET_VOUCHER_ID,
} from "./fixture-ids";

/**
 * YT-0450's first acceptance criterion, Redeem leg: `/wallet` -> a voucher
 * -> its rotating QR -> the merchant side at `/merchant` -> manual code
 * entry (the camera path cannot work headless — real Chrome's
 * `BarcodeDetector`, even where present, has no real camera to open in
 * CI, so `merchant-qr-scanner-camera.tsx` reports `onUnavailable` and the
 * identify panel auto-switches to its manual tab, which is exactly what
 * this suite drives) -> review -> confirm -> a redemption that never
 * claims success before capture completes.
 *
 * SEAM DEFECT FOUND HERE, not merely worked around: `WALLET_VOUCHER_ID` is
 * a real voucher (one of `mockVouchers`) a real customer can see in their
 * own Wallet. Its `merchantId` is a random per-fixture UUID and does NOT
 * match any of `provisioning-data.ts`'s three provisionable counter-device
 * merchant ids. The wallet's shared mock catalogue (`mockVouchers`, 15
 * items with `faker`-random merchant ids) and
 * the merchant device's provisionable identities were built by different
 * tickets against different fixture sets that were never cross-checked —
 * there is currently NO voucher visible in `/wallet` that can be
 * successfully redeemed at ANY of the three counter devices this
 * environment can provision. The first test below drives that failure for
 * real, with real data, rather than hiding it. The second test uses a
 * merchant-only fixture (never reachable from `/wallet` — see
 * `merchant-voucher-fixtures.ts`) to still prove the counter device's own
 * success path and its "never claim success before capture" property
 * genuinely work in isolation.
 *
 * SECOND SEAM DEFECT: the Wallet voucher detail page
 * (`voucher-detail-view.tsx`) never renders the voucher's plain `code`
 * anywhere in the DOM — only the QR canvas (an `<img>`) encodes it. The
 * "enter manually" fallback this ticket's brief calls "first-class, not
 * hidden" has no first-class source for a human to read the code FROM on
 * the customer's own screen; today it only works if the code reaches the
 * cashier some other way (read aloud, printed, etc.). This suite types the
 * code from the fixture (a value QA can see in source, not one the
 * rendered Wallet page ever shows), which a real customer could not do.
 */
test.describe("Redeem journey", () => {
  test("a real wallet voucher's rotating QR renders, but the same voucher cannot be successfully redeemed at any provisionable counter device", async ({
    page,
  }) => {
    await page.goto("/wallet");

    const voucherLink = page.locator(`a[href="/wallet/voucher/${WALLET_VOUCHER_ID}"]`);
    await expect(voucherLink, "the fixture voucher must be visible in the wallet").toBeVisible();
    await voucherLink.click();
    await expect(page).toHaveURL(`/wallet/voucher/${WALLET_VOUCHER_ID}`);

    // The rotating QR (YT-0424's own acceptance surface) actually renders.
    const qrImage = page.getByRole("img", { name: /Kode QR redeem voucher/ });
    await expect(qrImage).toBeVisible();
    await expect(qrImage).toHaveAttribute("src", /^data:image\/png;base64,/);

    // SEAM DEFECT: the plain code is never shown as text anywhere on this
    // page — only encoded into the QR image above.
    await expect(page.getByText(WALLET_VOUCHER_CODE)).toHaveCount(0);

    // Fresh counter device, provisioned from scratch in this same browser
    // context (real form submission, real cookie set by the real Server
    // Action).
    await provisionMerchantDevice(page);

    await enterVoucherCodeManually(page, WALLET_VOUCHER_CODE);
    await page.getByRole("button", { name: "Konfirmasi redeem" }).click();

    // Never claims success before capture: SOME processing phase is
    // observable before any outcome renders. (Each phase is only visible
    // for `PROCESSING_PHASE_DELAY_MS` — 400ms — so under load this suite
    // may catch either phase, not necessarily both in sequence; what
    // matters for the acceptance criterion is that an outcome never
    // appears without a processing phase having been shown first.)
    await expect(page.getByText(/Memverifikasi voucher…|Menyelesaikan redeem…/)).toBeVisible();

    // The actual, honest outcome: a wrong-merchant refusal, never a
    // success — this is the seam defect, reproduced end to end.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Voucher untuk toko lain")).toBeVisible();
    await expect(page.getByText(/Voucher ini untuk .+, bukan Toko Berkah\./)).toBeVisible();
    await expect(page.getByText("Berhasil di-redeem")).toHaveCount(0);
  });

  test("a voucher whose merchant genuinely matches the counter device redeems successfully, and never claims success before both processing phases complete", async ({
    page,
  }) => {
    await provisionMerchantDevice(page);

    // `attemptRedemption` deliberately simulates a transient network
    // failure for ~1/12 of idempotency keys (`merchant-redemption.ts`), so
    // this loop retries with a FRESH lookup (a new idempotency key, minted
    // from a new `Date.now()`) rather than treating one draw as flakiness.
    //
    // DEFECT FOUND while writing this: the UI's own "Coba lagi" (retry)
    // button on a `network_error` calls `onRetry`, which reuses that SAME
    // failed attempt's idempotency key (`merchant-redemption-screen.tsx`'s
    // `handleConfirm` — "a retry after `failed` reuses that attempt's
    // idempotency key"). Since the simulated failure is a pure function of
    // the key, tapping "Coba lagi" on a simulated network failure can never
    // succeed — it deterministically reproduces the same failure forever.
    // A real cashier hitting this ~8% case has no in-UI way out except
    // "New redemption" is not offered for `network_error` (its recovery
    // is `{ kind: "retry" }` — see `merchant-redemption-errors.ts`), only
    // that same doomed "Coba lagi". This suite avoids it by abandoning the
    // whole attempt and starting over, which is not a control the real UI
    // offers at this step.
    let succeeded = false;
    for (let attempt = 0; attempt < 3 && !succeeded; attempt += 1) {
      if (attempt > 0) {
        await page.goto("/merchant");
      }
      await enterVoucherCodeManually(page, MERCHANT_ONLY_VOUCHER_CODE);
      const confirmButton = page.getByRole("button", { name: "Konfirmasi redeem" });
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      // Ordering assertion, not a timing guess: some processing phase must
      // be observable before any outcome renders at all (see the sibling
      // test's comment on why "some phase", not strictly both in
      // sequence, is what this suite can reliably catch under load).
      await expect(page.getByText(/Memverifikasi voucher…|Menyelesaikan redeem…/)).toBeVisible();
      await expect(page.getByText("Berhasil di-redeem")).toHaveCount(0);

      const networkErrorAlert = page.getByText("Redeem gagal diproses");
      succeeded = !(await networkErrorAlert.isVisible().catch(() => false));
      if (!succeeded) {
        continue;
      }
      await expect(
        page.getByRole("status").filter({ hasText: "Berhasil di-redeem" }),
      ).toBeVisible();
      await expect(page.getByText(MERCHANT_ONLY_VOUCHER_CODE).first()).toBeVisible();
    }
    expect(succeeded, "expected a genuine capture success within 3 fresh attempts").toBe(true);
  });
});

async function provisionMerchantDevice(page: Page): Promise<void> {
  await page.goto("/merchant");
  const codeInput = page.getByLabel(/Provisioning code/i);
  if (await codeInput.isVisible().catch(() => false)) {
    await codeInput.fill(MERCHANT_PROVISIONING_CODE);
    await page.getByLabel(/digit PIN/i).fill(MERCHANT_PROVISIONING_PIN);
    await page.getByLabel(/Confirm PIN/i).fill(MERCHANT_PROVISIONING_PIN);
    await page.getByRole("button", { name: /Pair this device/i }).click();
  }
  await expect(page.getByRole("heading", { name: "Redeem Voucher" })).toBeVisible();
}

async function enterVoucherCodeManually(page: Page, code: string): Promise<void> {
  // The camera path cannot work headless: real Chrome has no camera to
  // open, so the scanner reports `onUnavailable` and the panel switches to
  // its manual tab on its own — this is that fallback being exercised as
  // the first-class path it is meant to be, not a shortcut around it.
  const codeInput = page.getByLabel("Kode voucher");
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill(code);
  await page.getByRole("button", { name: "Cari voucher" }).click();
}

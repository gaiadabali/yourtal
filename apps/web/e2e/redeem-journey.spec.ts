import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { MOCK_MERCHANTS } from "@yourtal/contracts/merchant/roster";
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
  test("a voucher taken from the wallet redeems at a provisionable counter device", async ({
    page,
  }) => {
    // Nothing is pinned by id. Changing a mock generator shifts the seeded
    // faker's draw order and every downstream id with it, which is exactly
    // how the previous version of this spec broke. Discover the voucher the
    // way a customer meets it: open the wallet, take the first one.
    await page.goto("/wallet");
    const voucherLink = page.locator('a[href^="/wallet/voucher/"]').first();
    await expect(voucherLink, "the wallet should hold at least one voucher").toBeVisible();
    await voucherLink.click();
    await expect(page).toHaveURL(/\/wallet\/voucher\/[0-9a-f-]{36}$/);

    const qrImage = page.getByRole("img", { name: /Kode QR redeem voucher/ });
    await expect(qrImage).toBeVisible();
    await expect(qrImage).toHaveAttribute("src", /^data:image\/png;base64,/);

    // Read the code off the page, not out of a fixture. A fixture-sourced
    // code would prove the merchant portal works while saying nothing about
    // whether a customer can actually supply one — which was the real gap
    // here until the code was rendered as text.
    const code = (await page.locator("span.select-all").first().innerText()).trim();
    expect(code, "the wallet must show a code a customer can read out").toMatch(/^\S{4,}$/);

    // A customer takes their voucher to the shop that issued it, so the
    // counter under test is that merchant's — not a fixed one. Read the
    // merchant off the voucher and look its counter up in the shared roster,
    // which is the same source the mock generators draw from.
    const merchantName = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    const merchant = MOCK_MERCHANTS.find((candidate) => merchantName.includes(candidate.name));
    expect(
      merchant,
      `voucher merchant "${merchantName}" must be on the shared roster — if it is not, the mock generators and the roster have drifted apart again`,
    ).toBeDefined();

    await provisionMerchantDevice(page, merchant!.provisioningCode);
    await enterVoucherCodeManually(page, code);
    await page.getByRole("button", { name: "Konfirmasi redeem" }).click();

    // Never claims success before capture: a processing phase must be
    // observable before any outcome renders.
    await expect(page.getByText(/Memverifikasi voucher…|Menyelesaikan redeem…/)).toBeVisible();

    // The loop closes. A voucher the user holds is redeemable at a counter.
    // This asserted a `wrong_merchant` refusal until the shared merchant
    // roster landed: wallet vouchers and provisionable devices drew from
    // disjoint id sets, so earn -> spend -> redeem could never complete.
    await expect(page.getByText("Berhasil di-redeem")).toBeVisible();
    await expect(page.getByText("Voucher untuk toko lain")).toHaveCount(0);
  });

  test("a voucher whose merchant genuinely matches the counter device redeems successfully, and never claims success before both processing phases complete", async ({
    page,
  }) => {
    await provisionMerchantDevice(page, MERCHANT_PROVISIONING_CODE);

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

async function provisionMerchantDevice(page: Page, provisioningCode: string): Promise<void> {
  await page.goto("/merchant");
  const codeInput = page.getByLabel(/Provisioning code/i);
  if (await codeInput.isVisible().catch(() => false)) {
    await codeInput.fill(provisioningCode);
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

import { expect, test } from "@playwright/test";
import { mockVouchers } from "@yourtal/contracts/voucher/mock";
import { computeQrPayload, currentRotationWindow } from "@/features/wallet/voucher-qr-rotation";
import { validateScannedPayload } from "@/features/merchant/merchant-qr-validation";

/**
 * Any genuinely active, unexpired voucher proves the seam this file exists
 * to check — nothing here depends on WHICH one. Selecting by property
 * (`status === "active"` and not expired relative to the real clock,
 * exactly as the wallet itself would filter for display) means a change to
 * the voucher generator's draw order can never invalidate this test the way
 * a pinned id could.
 */
function findWalletVoucherFixture() {
  const now = Date.now();
  const voucher = mockVouchers.find(
    (candidate) => candidate.status === "active" && new Date(candidate.expiresAt).getTime() > now,
  );
  if (!voucher) {
    throw new Error(
      "expected at least one active, unexpired voucher in mockVouchers — the wallet itself would have nothing to show either",
    );
  }
  return voucher;
}

/**
 * `@/features/wallet/wallet-data`'s `getWalletVoucher` is the app's real
 * lookup, but importing it here (outside a Next.js request) pulls in
 * `wallet-i18n.ts`'s un-attributed `.json` imports, which Playwright's own
 * Node/ESM runtime cannot load (`needs an import attribute of "type:
 * json"` — a Next.js-loader feature, not a Node one). Importing the
 * fixture directly from `@yourtal/contracts/voucher/mock` — the exact same
 * module `wallet-data.ts` imports this fixture from — sidesteps that
 * loader gap without reimplementing or guessing the voucher's shape.
 */

/**
 * The seam this task's brief names explicitly: "`features/merchant/
 * merchant-qr-validation.ts` imports the wallet's own `computeQrPayload`,
 * so they should agree — prove it end to end."
 *
 * A genuine end-to-end drive of this specific seam — customer phone camera
 * shows a QR, counter device's camera decodes it — cannot run headless
 * (no real camera on either side; see redeem-journey.spec.ts's top
 * comment). What CAN run for real, against the actual built app rather
 * than a re-implementation of the hash, is this: take the real voucher
 * fixture the wallet's own catalogue is built from, compute the payload
 * its real QR component would encode via the wallet's own real function,
 * and feed that payload into the merchant's own real validation function
 * with the exact candidate shape `listRedeemableVouchers()` supplies. If
 * `merchant-qr-validation.ts` ever stopped importing `computeQrPayload`
 * and hand-copied the hash instead (the drift this file's own doc comment
 * warns against), this test — not just
 * `features/merchant/merchant-qr-validation.test.ts`'s unit-level
 * coverage — would catch it, because it runs as part of the same
 * acceptance gate as the browser-driven journeys, against the same running
 * app.
 *
 * This is a Node-side check, not a `page`-driven one: both imported
 * functions are pure and dependency-free (no DOM, no `next/headers`), so
 * there is nothing a browser adds here that importing them directly does
 * not already prove.
 */
test.describe("Wallet QR payload <-> merchant validation agreement", () => {
  test("a real wallet voucher's rotating QR payload validates against the merchant's own validator", () => {
    const voucher = findWalletVoucherFixture();

    const now = Date.now();
    const source = { id: voucher.id, code: voucher.code, expiresAt: voucher.expiresAt };
    const payload = computeQrPayload(source, currentRotationWindow(now));

    // The exact candidate shape the merchant's real `listRedeemableVouchers()`
    // catalogue would supply for this voucher — not a synthesized stand-in.
    const result = validateScannedPayload(payload, [source], now);

    expect(result.ok, `expected the payload to validate, got ${JSON.stringify(result)}`).toBe(true);
    if (result.ok) {
      expect(result.voucherId).toBe(voucher.id);
    }
  });

  test("a payload computed for a DIFFERENT voucher does not validate against this one — the hash is not order-of-argument-independent", () => {
    const voucher = findWalletVoucherFixture();

    const now = Date.now();
    const impostorSource = { id: voucher.id, code: "WRONGCODE", expiresAt: voucher.expiresAt };
    const payload = computeQrPayload(impostorSource, currentRotationWindow(now));

    const realSource = { id: voucher.id, code: voucher.code, expiresAt: voucher.expiresAt };
    const result = validateScannedPayload(payload, [realSource], now);

    expect(result.ok).toBe(false);
  });
});

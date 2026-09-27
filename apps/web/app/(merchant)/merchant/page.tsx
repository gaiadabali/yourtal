import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMerchantDevice } from "@/features/merchant/merchant-data";
import { MerchantRedemptionScreen } from "@/features/merchant/merchant-redemption-screen";
import { isDeviceUnlocked } from "@/features/merchant/provisioning/device-session-cookie";
import { PinUnlockScreen } from "@/features/merchant/provisioning/pin-unlock-screen";
import { MerchantSessionChrome } from "@/features/merchant/provisioning/merchant-session-chrome";

export const metadata: Metadata = { title: "Redeem Voucher · YourTal Merchant" };

/**
 * `/merchant` (YT-0445) — the counter device's redemption portal.
 *
 * Route placement: this lives in its own `(merchant)` route group,
 * SIBLING to `(app)` — see this file's own git history for the full
 * reasoning (`(app)/layout.tsx` unconditionally wraps every route beneath
 * it in the five-tab consumer shell, which a shared shop device must
 * never surface).
 *
 * TASKS.md 8.1/8.2 REWRITE: `getMerchantDevice()` returning `null` now
 * redirects to `/merchant/pair` (the one public page,
 * `apps/web/proxy.ts`'s `MERCHANT_PAIR_PATH`) rather than rendering a
 * form inline here — this is also the D16 (8.2.f) enforcement point: a
 * hand-made or unsigned `yt_device` cookie value fails
 * `readDeviceBinding()`'s schema check exactly like a missing one, so it
 * is refused here even on the rare path where `proxy.ts`'s coarse
 * presence-only check would have let it through. A provisioned-but-locked
 * device (`isDeviceUnlocked()` false) renders `PinUnlockScreen` instead.
 * Only a paired AND unlocked device reaches the actual redemption screen,
 * wrapped in `MerchantSessionChrome` for the manual "Lock now" control
 * and the auto-lock listener.
 *
 * No voucher catalogue is loaded here, or anywhere in this route —
 * `MerchantRedemptionScreen` looks up one voucher per submitted code,
 * server-side, on demand (`counter-redemption-actions.ts`).
 */
export default async function MerchantRedemptionPage({ searchParams }: PageProps<"/merchant">) {
  const { error } = await searchParams;
  const errorParam = Array.isArray(error) ? error[0] : error;

  const device = await getMerchantDevice();
  if (!device) {
    redirect("/merchant/pair");
  }
  if (!(await isDeviceUnlocked())) {
    return <PinUnlockScreen device={device} error={errorParam} />;
  }

  return (
    <MerchantSessionChrome device={device}>
      <MerchantRedemptionScreen device={device} />
    </MerchantSessionChrome>
  );
}

import type { Metadata } from "next";
import { getMerchantDevice, listRedeemableVouchers } from "@/features/merchant/merchant-data";
import { MerchantRedemptionScreen } from "@/features/merchant/merchant-redemption-screen";
import { isDeviceUnlocked } from "@/features/merchant/provisioning/device-session-cookie";
import { DeviceProvisioningForm } from "@/features/merchant/provisioning/device-provisioning-form";
import { PinUnlockScreen } from "@/features/merchant/provisioning/pin-unlock-screen";
import { MerchantSessionChrome } from "@/features/merchant/provisioning/merchant-session-chrome";

export const metadata: Metadata = { title: "Redeem Voucher · YourTal Merchant" };

/**
 * `/merchant` (YT-0445) — the counter device's redemption portal.
 *
 * Route placement: this lives in its own `(merchant)` route group,
 * SIBLING to `(app)` — not under `apps/web/app/(app)/merchant/**` as
 * originally assigned. `(app)/layout.tsx` unconditionally wraps every
 * route beneath it in `AppShell`, which renders the five-tab consumer
 * bottom nav (Earn/Quick/Store/Wallet/Me) and the desktop side rail on
 * every route it wraps, with no per-route opt-out — see
 * `apps/web/features/shell/app-shell.tsx`. `docs/17-surfaces-and-roles.md`
 * §2.2 is explicit that a counter device's capabilities are "redeem a
 * voucher, look up a code, view today's redemptions. Nothing else" — a
 * shared shop device that also surfaces Earn/Quick/Store/Wallet/Me
 * invites exactly the wandering-into-consumer-surfaces that principle
 * forbids, wastes screen real estate this ticket's "huge touch targets"
 * brief needs, and cannot even highlight an active tab since none of the
 * five match `/merchant`. Since `(app)/layout.tsx` and
 * `(app)/loading.tsx` are marked SHARED and off limits, and Next.js route
 * groups do not affect the URL, a sibling `(merchant)` group keeps the
 * contract's actual promise — "/merchant and everything under it is
 * yours" — while giving this staff surface the root layout only
 * (`apps/web/app/layout.tsx`: fonts and `<html>/<body>`, no shell chrome)
 * instead of the consumer shell. No file under `(app)/` is touched.
 *
 * Kept a Server Component per docs/13b-typescript-standards.md §8: it
 * loads the device identity and the full voucher catalogue once, then
 * hands both as plain, already-resolved props to
 * `merchant-redemption-screen.tsx`, the one client leaf that owns the
 * flow's interaction.
 *
 * YT-0446 adds the two gates a real counter device needs before any of
 * that: `getMerchantDevice()` now returns `null` for a browser that has
 * never been provisioned (or was revoked — see `merchant-data.ts`), which
 * renders `DeviceProvisioningForm` instead; a provisioned-but-locked
 * device (`isDeviceUnlocked()` false — a fresh page load, or after
 * `lockDeviceAction` fires) renders `PinUnlockScreen` instead. Only a
 * provisioned AND unlocked device reaches `listRedeemableVouchers()` and
 * the actual redemption screen, wrapped in `MerchantSessionChrome` for the
 * manual "Lock now" control and the auto-lock listener. See
 * `apps/web/features/merchant/provisioning/` for all three.
 */
export default async function MerchantRedemptionPage({ searchParams }: PageProps<"/merchant">) {
  const { error } = await searchParams;
  const errorParam = Array.isArray(error) ? error[0] : error;

  const device = await getMerchantDevice();
  if (!device) {
    return <DeviceProvisioningForm error={errorParam} />;
  }
  if (!(await isDeviceUnlocked())) {
    return <PinUnlockScreen device={device} error={errorParam} />;
  }

  const vouchers = await listRedeemableVouchers();
  return (
    <MerchantSessionChrome device={device}>
      <MerchantRedemptionScreen device={device} vouchers={vouchers} />
    </MerchantSessionChrome>
  );
}

import type { Voucher } from "@yourtal/contracts/voucher";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
  mockVouchers,
} from "@yourtal/contracts/voucher/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import type { MerchantDevice } from "./merchant-device";
import { clearDeviceBinding, readDeviceBinding } from "./provisioning/device-session-cookie";
import { isDeviceRevoked } from "./provisioning/provisioning-data";
import {
  alreadyRedeemedVoucherFixture,
  healthyVoucherFixture,
  minimumSpendVoucherFixture,
  wrongMerchantVoucherFixture,
} from "./merchant-voucher-fixtures";

/**
 * The merchant portal's single data-access seam (same shape as
 * `apps/web/features/wallet/wallet-data.ts` — "one switch flips every
 * screen between mock and live", docs/tasks/phase-u-ui.md's phase
 * preamble). SERVER-DATA-ONLY per docs/13b-typescript-standards.md §8:
 * only `page.tsx`/`devices/page.tsx` (Server Components) in
 * `apps/web/app/(merchant)/merchant/` import this module.
 *
 * YT-0446 REWIRE: `getMerchantDevice()` used to hand back a hardcoded
 * device unconditionally — see this file's git history — on the
 * documented assumption that "YT-0446 owns real provisioning; this ticket
 * assumes it already happened." That assumption is what this rewrite
 * replaces: the device identity now comes from whatever this browser
 * actually paired via `apps/web/features/merchant/provisioning/` (the
 * httpOnly device-session cookie, `device-session-cookie.ts`), not a
 * constant. `getMerchantDevice()` therefore now returns `MerchantDevice |
 * null` — `null` means "this device has never been provisioned, or its
 * provisioning was revoked," and `apps/web/app/(merchant)/merchant/page.tsx`
 * renders the provisioning form in that case rather than a redemption
 * screen for a device that does not exist.
 *
 * The revocation check happens HERE, on every read, which is what makes
 * `policies/tests/store_device_test.yaml`'s spirit ("revocable instantly
 * and individually") land on the mock/offline layer this feature actually
 * has: a device found revoked is immediately un-paired
 * (`clearDeviceBinding()`) and treated exactly like a never-provisioned
 * one, sending it straight back to the provisioning form rather than
 * leaving a stale, still-rendering redemption screen up. See
 * `provisioning/provisioning-data.ts`'s comment for what is and is not
 * "immediate" about the mock revocation registry this checks against.
 */
const mockVoucherCatalogue: Voucher[] = [
  healthyVoucherFixture,
  expiringWithinHourVoucherFixture,
  expiredVoucherFixture,
  alreadyRedeemedVoucherFixture,
  minimumSpendVoucherFixture,
  wrongMerchantVoucherFixture,
  ...mockVouchers,
];

interface MerchantDataSource {
  getDevice: () => Promise<MerchantDevice | null>;
  listVouchers: () => Promise<Voucher[]>;
}

async function getBoundMockDevice(): Promise<MerchantDevice | null> {
  const binding = await readDeviceBinding();
  if (!binding) {
    return null;
  }
  if (await isDeviceRevoked(binding.deviceId)) {
    await clearDeviceBinding();
    return null;
  }
  return {
    id: binding.deviceId,
    label: binding.label,
    merchantId: binding.merchantId,
    merchantName: binding.merchantName,
    locale: binding.locale,
    currency: binding.currency,
    countryName: binding.countryName,
  };
}

const mockDataSource: MerchantDataSource = {
  getDevice: () => getBoundMockDevice(),
  listVouchers: () => Promise.resolve(mockVoucherCatalogue),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live merchant redemption data source is not implemented yet (Phase U is mock-only; docs/09 section 8's authorize/capture API has no BFF client yet).";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see wallet-data.ts / campaign-data.ts for the
 * same reasoning. The real implementation will call
 * `POST /v1/vouchers/authorize` and `/capture` (docs/09 §8.1) instead of
 * `merchant-redemption.ts`'s simulated `attemptRedemption`, and will
 * resolve the device from a real server-issued session rather than this
 * mock's cookie (docs/17 §2.2's "long-lived refresh credential" would be
 * minted and validated by that backend, not read out of a client-visible
 * cookie name); that function's `Result`-shaped signature is designed so
 * only its body changes.
 */
const liveDataSource: MerchantDataSource = {
  getDevice: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listVouchers: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const merchantDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** The signed-in counter device's identity, or `null` if this browser has never been provisioned (or was revoked) — see this file's YT-0446 doc comment. */
export function getMerchantDevice(): Promise<MerchantDevice | null> {
  return merchantDataSource.getDevice();
}

/** Every voucher a customer might present at this counter, across every merchant — a real lookup call has no narrower a priori scope than this. */
export function listRedeemableVouchers(): Promise<Voucher[]> {
  return merchantDataSource.listVouchers();
}

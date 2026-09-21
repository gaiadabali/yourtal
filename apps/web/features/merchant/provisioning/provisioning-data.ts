import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { MOCK_MERCHANTS } from "@yourtal/contracts/merchant/roster";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import { resolveMerchantRegionInfo } from "../merchant-region-source";
import { deriveCounterLocation } from "../merchant-counter-location";

/**
 * The provisioning/revocation data-access seam — same shape and same rule
 * as `merchant-data.ts`: "one switch flips every screen between mock and
 * live." SERVER-ONLY (value-imports `@yourtal/contracts/mock-source` and,
 * transitively via `merchant-region-source.ts`, `@yourtal/contracts/region`)
 * — only `provisioning-actions.ts` (`"use server"`) and
 * `app/(merchant)/merchant/devices/page.tsx` (a Server Component) import
 * this module.
 *
 * WHAT THIS TICKET DOES NOT BUILD: the Admin-facing half of provisioning —
 * generating a provisioning code bound to a merchant and a named location —
 * belongs to the business console's Team zone
 * (docs/17-surfaces-and-roles.md section 2.1/2.2), which is another
 * agent's territory and does not exist yet in this codebase. The mock
 * codes below stand in for "codes an Admin has already generated," exactly
 * the way `merchant-voucher-fixtures.ts` stands in for vouchers a real
 * campaign would have minted. A real implementation replaces
 * `MOCK_PROVISIONING_CODES` with a lookup against a `store_device` row a
 * console mutation created, single-use or short-expiry (a code that works
 * forever is a standing credential, not a pairing step), and logs the
 * pairing event per docs/17 section 2.1's "every team action is
 * audit-logged."
 *
 * WHAT THIS TICKET ALSO DOES NOT BUILD: a real, durable, cross-instance
 * revocation registry. `revokedDeviceIds` below is a plain in-process
 * `Set` — it resets on every server restart/redeploy and is NOT shared
 * across multiple serverless instances, so "revoke" here is only
 * immediate and correct for a single long-running dev server. A real
 * implementation needs the revoked flag in Postgres (or Redis, for the <5s
 * propagation docs/14-security-engineering.md section 6 asks of the
 * merchant-suspended kill switch, which this is the device-scoped sibling
 * of) and checked through the same Cerbos `store_device_of` derived-role
 * path `policies/resource_policies/redemption.yaml` already defines —
 * this mock checks a `Set.has()` where a real deployment checks a policy
 * decision.
 */
export interface ProvisioningTemplate {
  merchantId: string;
  merchantName: string;
  label: string;
  /** The outlet this counter stands in — `label` is the till, this is the shop (YT-0583). */
  location: MerchantLocation;
  locale: "en-AU" | "id-ID";
  currency: "AUD" | "IDR";
  countryName: string;
}

export interface KnownDeviceSummary {
  deviceId: string;
  merchantName: string;
  label: string;
  revoked: boolean;
}

/**
 * `"TOKO-BERKAH-1"` deliberately resolves to the SAME merchantId
 * ("00000000-0000-4000-8000-000000000601", "Toko Berkah") that
 * `merchant-voucher-fixtures.ts`'s catalogue is built against, so
 * provisioning this device and then redeeming `healthyVoucherFixture`,
 * `alreadyRedeemedVoucherFixture` and `minimumSpendVoucherFixture` all
 * still resolve as the SAME merchant, and `wrongMerchantVoucherFixture`
 * ("Kopi Kenangan Kemang") still correctly triggers `wrong_merchant`. A
 * different code, for a different (mock) shop, is included so the "device
 * bound to exactly one merchant" property is visible with more than one
 * example.
 */
/**
 * Derived from the shared merchant roster, never hand-listed.
 *
 * This used to hardcode three of the roster's merchants. That was the second
 * half of a seam defect: wallet vouchers are issued by any roster merchant,
 * but only those three had counters, so a customer holding a voucher from
 * any of the others could not redeem it anywhere — a real browser run ended
 * in `wrong_merchant` every time. `provisioningCode` is required on every
 * roster entry precisely so that a merchant which cannot redeem its own
 * vouchers is unrepresentable; deriving the registry is what makes that
 * guarantee hold on this side too.
 */
const MOCK_PROVISIONING_CODES: Record<string, ProvisioningTemplate> = Object.fromEntries(
  MOCK_MERCHANTS.map((merchant) => [
    merchant.provisioningCode.toUpperCase(),
    {
      merchantId: merchant.id,
      merchantName: merchant.name,
      label: merchant.counterLabel,
      // YT-0583: the outlet this counter stands in, as distinct from the
      // till it is. See merchant-counter-location.ts for what is real here
      // and what is placeholder.
      location: deriveCounterLocation(merchant.id, merchant.name, merchant.region),
      ...resolveMerchantRegionInfo(merchant.region),
    },
  ]),
);

/** Module-scope mock revocation registry — see the file-level comment for exactly what this does and does not model. */
const revokedDeviceIds = new Set<string>();

/**
 * Illustrative "known devices" for the `/merchant/devices` mock console
 * stand-in. In a real system this is a query against the business's own
 * `store_device` roster (Team zone); here it is a fixed list plus whatever
 * this browser has actually paired, so the page has more than one row to
 * demonstrate revoking against.
 */
const MOCK_OTHER_DEVICES: KnownDeviceSummary[] = [
  {
    deviceId: "counter-kemang-2",
    merchantName: "Kopi Kenangan Kemang",
    label: "Kemang counter 2",
    revoked: false,
  },
  {
    deviceId: "counter-sydney-cbd-1",
    merchantName: "Sydney CBD Cafe",
    label: "Sydney CBD — Register 1",
    revoked: false,
  },
];

interface ProvisioningDataSource {
  resolveCode: (code: string) => Promise<ProvisioningTemplate | null>;
  isDeviceRevoked: (deviceId: string) => Promise<boolean>;
  revokeDevice: (deviceId: string) => Promise<void>;
  listOtherKnownDevices: () => Promise<KnownDeviceSummary[]>;
}

const mockProvisioningDataSource: ProvisioningDataSource = {
  resolveCode: (code) =>
    Promise.resolve(MOCK_PROVISIONING_CODES[code.trim().toUpperCase()] ?? null),
  isDeviceRevoked: (deviceId) => Promise.resolve(revokedDeviceIds.has(deviceId)),
  revokeDevice: (deviceId) => {
    revokedDeviceIds.add(deviceId);
    return Promise.resolve();
  },
  listOtherKnownDevices: () =>
    Promise.resolve(
      MOCK_OTHER_DEVICES.map((device) => ({
        ...device,
        revoked: revokedDeviceIds.has(device.deviceId),
      })),
    ),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live device provisioning is not implemented yet (Phase U is mock-only; there is no store_device console or BFF endpoint for pairing/revocation).";

const liveProvisioningDataSource: ProvisioningDataSource = {
  resolveCode: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  isDeviceRevoked: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  revokeDevice: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listOtherKnownDevices: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const provisioningDataSource = resolveDataSource({
  mock: mockProvisioningDataSource,
  live: liveProvisioningDataSource,
});

export function resolveProvisioningCode(code: string): Promise<ProvisioningTemplate | null> {
  return provisioningDataSource.resolveCode(code);
}

export function isDeviceRevoked(deviceId: string): Promise<boolean> {
  return provisioningDataSource.isDeviceRevoked(deviceId);
}

export function revokeDevice(deviceId: string): Promise<void> {
  return provisioningDataSource.revokeDevice(deviceId);
}

export function listOtherKnownDevices(): Promise<KnownDeviceSummary[]> {
  return provisioningDataSource.listOtherKnownDevices();
}

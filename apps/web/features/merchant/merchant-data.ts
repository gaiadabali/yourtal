import type { MerchantDevice } from "./merchant-device";
import { readDeviceBinding } from "./provisioning/device-session-cookie";

/**
 * The merchant portal's device-identity seam. SERVER-DATA-ONLY per
 * docs/13b-typescript-standards.md §8: only `page.tsx` (a Server Component)
 * imports this module.
 *
 * TASKS.md 8.1/8.2 REWRITE: this used to also hold `listRedeemableVouchers()`
 * — a whole client-visible voucher catalogue, exactly what D16 (8.2.f)
 * exists to delete. There is no catalogue any more, mock or otherwise:
 * `counter-redemption-actions.ts` looks up ONE voucher per submitted code,
 * server-side, on demand.
 *
 * `getMerchantDevice()` no longer distinguishes "never paired" from
 * "revoked" — both look identical from here (`readDeviceBinding()` returns
 * `null`), because there is nothing left to check locally: a revoked
 * credential is caught for real the moment `unlockWithPin` or any counter
 * call 401s (`invalid_device_credential`), which is when this browser's
 * binding actually gets cleared. This function only ever reports whatever
 * the cookie currently says.
 */
export async function getMerchantDevice(): Promise<MerchantDevice | null> {
  const binding = await readDeviceBinding();
  if (!binding) {
    return null;
  }
  // Locale defaults to "en-AU" until TASKS.md 8.1's device-info gap closes
  // (see merchant-i18n.ts) — never affects a redemption's currency.
  return { id: binding.deviceId, locale: "en-AU" };
}

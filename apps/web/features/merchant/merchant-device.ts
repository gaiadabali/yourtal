import type { Region } from "@yourtal/contracts/region";
import type { Currency } from "@yourtal/contracts/money/currency";
import { regionDisplayConfig } from "@/features/region/region-config";

/**
 * Plain, UI-level shape of a paired counter device (TASKS.md 8.1/8.2).
 *
 * Everything here is learned from the device's own region, which
 * `POST /api/devices/pair` and `/unlock` both return, so a counter speaks
 * its own language, currency and time zone from its first screen. It
 * falls back to AU only for a binding saved before the region was kept,
 * until that device's next PIN unlock. The CHROME language and the
 * fallback currency (an empty log's total) come from here; a redemption's
 * own currency always comes fresh off that voucher's lookup response
 * (`CounterVoucherPreview.currency`,
 * `@yourtal/contracts/device/counter-redemption`).
 */
export type MerchantLocale = "en-AU" | "id-ID";

export interface MerchantDevice {
  /** The paired device's own id: scopes the today log's key and is the last-resort name on screen. */
  id: string;
  locale: MerchantLocale;
  region: Region;
  /** The device region's own currency: what an empty log's total and any amount without a voucher are in. */
  currency: Currency;
  /** What the owner called this counter in Studio; `null` for a binding saved before it was kept. */
  label: string | null;
  /** The shop this counter is at; `null` likewise. */
  locationName: string | null;
}

export function buildMerchantDevice(input: {
  id: string;
  region?: Region | undefined;
  label?: string | undefined;
  locationName?: string | undefined;
}): MerchantDevice {
  const region = input.region ?? "AU";
  const { locale, currency } = regionDisplayConfig(region);
  return {
    id: input.id,
    locale,
    region,
    currency,
    label: input.label ?? null,
    locationName: input.locationName ?? null,
  };
}

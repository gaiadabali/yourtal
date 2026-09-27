/**
 * Plain, UI-level shape of a paired counter device (TASKS.md 8.1/8.2).
 *
 * REWRITE: this used to carry a whole mock profile (merchant name, label,
 * location, currency, country name) because there was no real backend to
 * ask. There is now (`apps/api/src/modules/devices`), but pairing
 * (`POST /api/devices/pair`) and unlocking (`POST /api/devices/unlock`)
 * both return only an opaque credential/deviceId — neither the studio
 * provisioning record's `label`/`locationId`/`region` reaches the paired
 * device itself. There is no endpoint yet for a paired device to read its
 * OWN display info back (`(requested by B)` on TASKS.md 8.1 asks for one:
 * extending `unlockDeviceResultSchema` with the device's own
 * `CounterDevice`, since `device-unlock.controller.ts` already loads that
 * row before calling `unlockDevice`).
 *
 * Until that lands, `locale` is a fixed `"en-AU"` default for this
 * portal's CHROME text only (heading, buttons, error copy) — it never
 * decides a redemption's currency, which always comes fresh off that
 * voucher's own lookup response (`CounterVoucherPreview.currency`,
 * `@yourtal/contracts/device/counter-redemption`). A wrong chrome
 * language is a UX gap; a wrong money currency would be a real defect —
 * this design cannot produce the second kind.
 */
export type MerchantLocale = "en-AU" | "id-ID";

export interface MerchantDevice {
  /** The paired device's own id — used to scope the today log's key, not for display (there is nothing to display it as yet). */
  id: string;
  locale: MerchantLocale;
}

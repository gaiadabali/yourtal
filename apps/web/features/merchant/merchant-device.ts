/**
 * Plain, UI-level shape of a paired counter device (TASKS.md 8.1/8.2).
 *
 * REWRITE: this used to carry a whole mock profile (merchant name, label,
 * location, currency, country name) because there was no real backend to
 * ask. `POST /api/devices/unlock` now returns the device's own `region`
 * (device-binding-schema.ts's own doc comment) — `locale` here is derived
 * from that (`region-config.ts`'s `regionDisplayConfig`), and falls back to
 * `"en-AU"` only until the device's first real unlock-with-PIN call learns
 * its region for the first time. This is CHROME text only (heading,
 * buttons, error copy) — it never decides a redemption's currency, which
 * always comes fresh off that voucher's own lookup response
 * (`CounterVoucherPreview.currency`,
 * `@yourtal/contracts/device/counter-redemption`). A wrong chrome language
 * is a UX gap; a wrong money currency would be a real defect — this design
 * cannot produce the second kind.
 */
export type MerchantLocale = "en-AU" | "id-ID";

export interface MerchantDevice {
  /** The paired device's own id — used to scope the today log's key, not for display (there is nothing to display it as yet). */
  id: string;
  locale: MerchantLocale;
}

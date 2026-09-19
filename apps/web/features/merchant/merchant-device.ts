/**
 * Plain, UI-level shape of a provisioned counter device (YT-0445; device
 * provisioning and PIN unlock itself is YT-0446, a separate, dependent
 * ticket — this feature assumes a device identity already exists and
 * renders against it).
 *
 * Deliberately NOT a `@yourtal/contracts` type: there is no wire contract
 * for a store device yet (see `docs/17-surfaces-and-roles.md` section 2.2
 * and `policies/resource_policies/redemption.yaml`'s `store_device_of`
 * derived role for the authorization shape this will eventually bind to).
 * `locale`/`currency`/`countryName` are plain string literals — resolved
 * once, server-side, in `merchant-region-source.ts` from the real
 * `@yourtal/contracts/region` contract — so this type and every client leaf
 * that consumes it stays completely decoupled from that package. If the
 * region contract is not yet installed, only `merchant-region-source.ts`
 * (and `merchant-data.ts`, which calls it) is affected; nothing here is.
 */
export type MerchantLocale = "en-AU" | "id-ID";
export type MerchantCurrency = "AUD" | "IDR";

export interface MerchantDevice {
  /** Stable id for this device, e.g. "counter-kemang-2" — used to scope the local today log (docs/17 §2.2: "every redemption records the device"). */
  id: string;
  /** Staff-facing name, e.g. "Kemang counter 2". */
  label: string;
  merchantId: string;
  merchantName: string;
  locale: MerchantLocale;
  currency: MerchantCurrency;
  countryName: string;
}

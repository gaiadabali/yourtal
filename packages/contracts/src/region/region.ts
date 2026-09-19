import { z } from "zod";

/**
 * YourTal runs two regions, Australia and Indonesia, picked once by the user
 * at registration — each with its own tax, regulatory and currency setup
 * (docs/tasks/phase-u-ui.md YT-0405). Australia is the real market;
 * Indonesia is the proving ground. Every screen must be able to render
 * either region correctly, which starts with a single, shared source of
 * truth for what a region IS: its locale and its currency.
 *
 * This is deliberately a closed two-value enum, not an open country list —
 * adding a third region is a product and regulatory decision (new tax rules,
 * a new PSP integration, docs/15's "two data planes" rule), not a config
 * change, so the type should not make it look like one.
 */
export const regionSchema = z.enum(["AU", "ID"]);
export type Region = z.infer<typeof regionSchema>;

export interface RegionConfig {
  /** BCP-47 locale, used for every `Intl.*` call this region's screens make. */
  readonly locale: "en-AU" | "id-ID";
  /** ISO 4217 currency code. AUD is unambiguously two-decimal; IDR's minor
   * unit is still unresolved (YT-0506, see `../money/money.ts`) — this
   * table records which currency a region uses, not how many decimals its
   * stored amount has. */
  readonly currency: "AUD" | "IDR";
  readonly countryName: string;
}

/**
 * The one place a region's locale, currency and display name are decided.
 * Every other module — `money-format.ts`'s currency-to-locale mapping,
 * `apps/web/features/region`'s client-safe mirror, mock fixtures — must
 * agree with this table; `region.test.ts` is the round-trip check, and
 * `apps/web/features/region/region-config.test.ts` is the cross-package
 * drift check for the client-safe mirror (see that file for why it is a
 * mirror and not a value-import).
 */
export const REGION_CONFIG: Record<Region, RegionConfig> = {
  AU: { locale: "en-AU", currency: "AUD", countryName: "Australia" },
  ID: { locale: "id-ID", currency: "IDR", countryName: "Indonesia" },
};

import { notFound } from "next/navigation";

/**
 * Locale/region resolution for the public surface (YT-0431), derived from the
 * `[locale]` route segment under `app/(public)/[locale]/**` — never from a
 * cookie. `docs/13b-typescript-standards.md` §8's static-generation rule and
 * this ticket's brief are explicit that `getRegion()`
 * (`apps/web/features/region/get-region.ts`) calls `cookies()` and therefore
 * opts a route into dynamic rendering, which is wrong for a page that must be
 * statically generated and indexable (`docs/11-seo-aeo-geo.md` §1). Every
 * public page reads its region from this file's `PublicLocale` param instead.
 *
 * This deliberately does NOT import `@yourtal/contracts/region`: that module
 * exports `regionSchema` (a Zod value) alongside `REGION_CONFIG` from the
 * same file, and `@yourtal/contracts/money/format`'s own docstring explains
 * why even a type-only import of that module is avoided in code that must
 * stay Zod-free — every public route is a Server Component with zero client
 * leaves (see this ticket's report), so the risk is smaller here, but
 * spelling the two-locale table out literally costs nothing and keeps this
 * module trivially safe to import from anywhere, present or future.
 *
 * **Why `PUBLIC_LOCALES` lists "au" but nothing generates an `/au/**` page
 * yet:** the mock catalogues this ticket reads from
 * (`@yourtal/contracts/campaign/mock`, `@yourtal/contracts/listing/mock`)
 * are Indonesia-only in substance — Jakarta districts, Rupiah-denominated
 * `faceValueIdr` — there is no separate AU merchant/listing fixture set.
 * Reinterpreting the exact same Rupiah amounts as AUD for an `/au/...` page
 * would misstate real money figures, which is a worse dishonesty than the
 * one this ticket exists to prevent. The type and the formatting call sites
 * below are region-generic (nothing hardcodes `id-ID`/`Rp`); only the
 * static-generation param list (`apps/web/app/(public)/[locale]/layout.tsx`
 * and each route's `generateStaticParams`) currently emits `"id"` alone.
 * Adding a real `"au"` catalogue is a data-layer follow-up, not a routing
 * change — see this ticket's report.
 */

export const PUBLIC_LOCALES = ["id", "au"] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

/** Locales this ticket actually pre-renders. See the module docstring for why "au" is listed but not yet built. */
export const GENERATED_PUBLIC_LOCALES: readonly PublicLocale[] = ["id"];

export function isPublicLocale(value: string): value is PublicLocale {
  return (PUBLIC_LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows a route param to `PublicLocale` or calls Next's `notFound()`
 * (which throws — its return type is `never`, so TypeScript narrows the
 * caller's binding after this returns without an `as` cast). Every route
 * under `app/(public)/[locale]/**` calls this first so an unlisted locale
 * segment 404s the same way everywhere, rather than each page re-deriving
 * its own check.
 */
export function requirePublicLocale(value: string): PublicLocale {
  if (!isPublicLocale(value)) {
    notFound();
  }
  return value;
}

export interface PublicLocaleConfig {
  /** BCP-47 locale for every `Intl.*` call a public page makes. */
  readonly intlLocale: "en-AU" | "id-ID";
  /** ISO 4217 currency this locale prices offers in. */
  readonly currency: "AUD" | "IDR";
  readonly countryName: string;
}

const PUBLIC_LOCALE_CONFIG: Record<PublicLocale, PublicLocaleConfig> = {
  id: { intlLocale: "id-ID", currency: "IDR", countryName: "Indonesia" },
  au: { intlLocale: "en-AU", currency: "AUD", countryName: "Australia" },
};

export function publicLocaleConfig(locale: PublicLocale): PublicLocaleConfig {
  return PUBLIC_LOCALE_CONFIG[locale];
}

/**
 * Production origin every canonical/OG/JSON-LD absolute URL on the public
 * surface is built from (`docs/11-seo-aeo-geo.md` §2.2: "Absolute URL, on
 * every public page"). `app/(app)/**`/`app/(merchant)/**` do not need this —
 * neither is indexed — so it is scoped to this feature rather than a
 * repo-wide `metadataBase` in the shared root `app/layout.tsx`, which this
 * ticket does not own.
 */
export const PUBLIC_SITE_URL = "https://yourtal.com";

/** Builds an absolute, locale-prefixed URL under the public site origin, e.g. `publicUrl("id", "/c/abc")`. */
export function publicUrl(locale: PublicLocale, path: string): string {
  return new URL(`/${locale}${path}`, PUBLIC_SITE_URL).toString();
}

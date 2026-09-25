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
 * **YT-0181: `/au` used to 404.** `PUBLIC_LOCALES` has always listed `"au"`,
 * but `GENERATED_PUBLIC_LOCALES` only ever emitted `"id"` because the mock
 * campaign/listing catalogues this feature read from
 * (`@yourtal/contracts/campaign/mock`, `@yourtal/contracts/listing/mock`)
 * were Indonesia-only in substance — Jakarta districts, Rupiah-denominated
 * `faceValueMinor`. Reinterpreting the same Rupiah amounts as AUD would have
 * misstated real money figures, so this file deliberately did not generate
 * `/au/**` rather than fake it.
 *
 * That blocker is gone: `@yourtal/contracts/region/mock` now carries a real,
 * independently-seeded AU catalogue (Sydney merchants, `audCents`-scaled
 * amounts — see `region-mock-au-listing.ts`/`region-mock-au-campaign.ts`),
 * exposed as `REGION_CAMPAIGN_FIXTURES.AU`/`REGION_LISTING_FIXTURES.AU`.
 * `public-campaign-data.ts`, `public-listing-data.ts` and `public-merchant.ts`
 * now take a `PublicLocale` and read that catalogue for `"au"`, the existing
 * ID-only fixtures for `"id"`. `GENERATED_PUBLIC_LOCALES` below now lists
 * both, so AU gets its own statically-generated pages with genuinely AU
 * data rather than a relabelled Indonesian one.
 */

export const PUBLIC_LOCALES = ["id", "au"] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

/** Locales this feature pre-renders. Kept distinct from `PUBLIC_LOCALES` as a seam: a locale can be a real, typed value before it has a generated catalogue (see the module docstring for how "au" used that seam). */
export const GENERATED_PUBLIC_LOCALES: readonly PublicLocale[] = ["id", "au"];

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

/**
 * `hreflang` alternates for `metadata.alternates.languages` (YT-0181),
 * keyed by BCP-47 tag as Next's Metadata API expects. **Only for pages that
 * are genuinely the same page in another region** — the locale root and the
 * catalogue hub, where `/id/rewards` and `/au/rewards` are honestly "this
 * kind of page, for that region."
 *
 * This is deliberately NOT used on a campaign/offer/merchant page: AU and ID
 * read from two independently-seeded catalogues (see this file's header),
 * so a specific Jakarta campaign has no AU counterpart to declare as its
 * alternate — there is no "same page in English" for it, only a different
 * merchant's different campaign. Emitting an alternate there would tell a
 * crawler two unrelated pages are the same content in two locales, which is
 * the wrong direction for this ticket to err in. If a future ticket gives
 * AU and ID a genuine shared entity (e.g. a merchant present in both
 * regions), that page can grow its own alternates; this helper stays scoped
 * to what is actually true today.
 */
export function publicLanguageAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of GENERATED_PUBLIC_LOCALES) {
    languages[publicLocaleConfig(locale).intlLocale] = publicUrl(locale, path);
  }
  return languages;
}

import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";

// URL slug → catalogue key under `public.pages`.
const PAGE_KEYS = {
  help: "help",
  "how-points-work": "points",
  "for-business": "business",
  terms: "terms",
  privacy: "privacy",
} as const;

export type PublicInfoSlug = keyof typeof PAGE_KEYS;

export const PUBLIC_INFO_SLUGS = Object.keys(PAGE_KEYS) as PublicInfoSlug[];

// Legal copy has not been through counsel, so it carries a draft notice on staging.
const LEGAL_SLUGS: readonly PublicInfoSlug[] = ["terms", "privacy"];

export function isPublicInfoSlug(value: string): value is PublicInfoSlug {
  return Object.hasOwn(PAGE_KEYS, value);
}

export interface PublicInfoSection {
  heading: string;
  body: string[];
}

export interface PublicInfoPage {
  slug: PublicInfoSlug;
  title: string;
  description: string;
  lead: string;
  sections: PublicInfoSection[];
  isLegal: boolean;
  /** Only the business page has a call to action. */
  cta: { label: string; href: string } | null;
}

export function publicInfoPage(locale: SupportedLocale, slug: PublicInfoSlug): PublicInfoPage {
  const t = getPublicTranslator(locale);
  const key = PAGE_KEYS[slug];
  return {
    slug,
    title: t(`pages.${key}.title`),
    description: t(`pages.${key}.description`),
    lead: t(`pages.${key}.lead`),
    sections: t.raw(`pages.${key}.sections`) as PublicInfoSection[],
    isLegal: LEGAL_SLUGS.includes(slug),
    cta: key === "business" ? { label: t("pages.business.cta"), href: "/business" } : null,
  };
}

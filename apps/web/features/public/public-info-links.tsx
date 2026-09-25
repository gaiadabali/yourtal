import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";
import { PUBLIC_INFO_SLUGS, publicInfoPage } from "./public-info-pages";

export interface PublicInfoLinksProps {
  locale: SupportedLocale;
  /** The route prefix the links hang off, e.g. `/au`. */
  basePath: string;
}

/** Help, how points work, for business, terms and privacy, for the footer. */
export function PublicInfoLinks({ locale, basePath }: PublicInfoLinksProps) {
  const t = getPublicTranslator(locale);
  return (
    <nav aria-label={t("footerLinks.heading")}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {PUBLIC_INFO_SLUGS.map((slug) => (
          <li key={slug}>
            <a href={`${basePath}/${slug}`} className="hover:text-fg">
              {publicInfoPage(locale, slug).title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

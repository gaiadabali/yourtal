import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";
import type { ReactNode } from "react";

export interface PublicFooterProps {
  locale: SupportedLocale;
  /** Extra rows under the tagline, e.g. `PublicInfoLinks`. */
  children?: ReactNode;
}

/**
 * Tagline and both region entry points, so a visitor on the wrong region
 * can switch. Plain anchors: the public group ships no client JS.
 */
export function PublicFooter({ locale, children }: PublicFooterProps) {
  const t = getPublicTranslator(locale);
  return (
    <footer className="border-t border-border-subtle px-gutter-sm py-6 text-body-sm text-fg-muted md:px-gutter-md">
      <p>{t("footer.tagline")}</p>
      {children ? <div className="mt-3">{children}</div> : null}
      <nav aria-label={t("footer.regionsHeading")} className="mt-3 flex gap-4">
        <a href="/au" hrefLang="en-AU" className="hover:text-fg">
          {t("footer.au")}
        </a>
        <a href="/id" hrefLang="id-ID" className="hover:text-fg">
          {t("footer.id")}
        </a>
      </nav>
    </footer>
  );
}

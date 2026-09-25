import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";

export interface PublicFooterProps {
  locale: SupportedLocale;
}

/**
 * The public surface's footer (task 3.5.c) — a one-line tagline and the two
 * region entry points, so a visitor who landed on the wrong region's site
 * can switch. Plain anchors, not `next/link`: same RSC-only, zero-client-JS
 * reasoning as `public-header.tsx`'s log-in link and `public-cta-link.tsx`.
 */
export function PublicFooter({ locale }: PublicFooterProps) {
  const t = getPublicTranslator(locale);
  return (
    <footer className="border-t border-border-subtle px-gutter-sm py-6 text-body-sm text-fg-muted md:px-gutter-md">
      <p>{t("footer.tagline")}</p>
      <nav aria-label={t("footer.regionsHeading")} className="mt-3 flex gap-4">
        <a href="/au" className="hover:text-fg">
          {t("footer.au")}
        </a>
        <a href="/id" className="hover:text-fg">
          {t("footer.id")}
        </a>
      </nav>
    </footer>
  );
}

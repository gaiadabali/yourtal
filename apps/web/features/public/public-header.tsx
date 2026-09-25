import { BrandWordmark } from "@yourtal/ui/brand/wordmark";
import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";
import { PublicCtaLink } from "./public-cta-link";

export interface PublicHeaderProps {
  locale: SupportedLocale;
  homeHref: string;
}

/**
 * The minimal chrome every `(public)` page shares — a wordmark linking home,
 * a log-in link and a sign-up affordance — standing in for the logged-in
 * `ViewerShell` (`apps/web/features/shell/viewer-shell.tsx`) that
 * `(app)/layout.tsx` gives every route it wraps. Deliberately much smaller:
 * a five-tab bottom nav makes no sense for an anonymous visitor with nothing
 * to navigate to yet, and every extra byte here is initial-JS budget every
 * public route pays (docs/13b-typescript-standards.md §8). No client state,
 * no "use client".
 *
 * The log-in link is a plain `<a href="/au">`, not `/login` — that route
 * does not exist yet (task 3.5.d moves the real auth screens in later), so
 * this points at the AU public entry point as a placeholder, the same way
 * `homeHref` already does for the wordmark. It stays a plain anchor rather
 * than `next/link` for the same reason `PublicCtaLink` gives: this group is
 * RSC-only with zero client leaves by design.
 */
export function PublicHeader({ locale, homeHref }: PublicHeaderProps) {
  const t = getPublicTranslator(locale);
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border-subtle px-gutter-sm py-3 md:px-gutter-md">
      <a href={homeHref}>
        <BrandWordmark size="sm" />
      </a>
      <div className="flex items-center gap-4">
        <a href="/au" className="text-label font-sans font-medium text-fg-muted hover:text-fg">
          {t("header.logIn")}
        </a>
        <PublicCtaLink href="/onboarding">{t("header.signUp")}</PublicCtaLink>
      </div>
    </header>
  );
}

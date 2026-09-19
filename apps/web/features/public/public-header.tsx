import type { SupportedLocale } from "./public-i18n";
import { getPublicTranslator } from "./public-i18n";
import { PublicCtaLink } from "./public-cta-link";

export interface PublicHeaderProps {
  locale: SupportedLocale;
  homeHref: string;
}

/**
 * The minimal chrome every `(public)` page shares — a wordmark linking home
 * and a sign-up affordance — standing in for the logged-in `AppShell`
 * (`apps/web/features/shell/app-shell.tsx`) that `(app)/layout.tsx` gives
 * every route it wraps. Deliberately much smaller: a five-tab bottom nav
 * makes no sense for an anonymous visitor with nothing to navigate to yet,
 * and every extra byte here is initial-JS budget every public route pays
 * (docs/13b-typescript-standards.md §8). No client state, no "use client".
 */
export function PublicHeader({ locale, homeHref }: PublicHeaderProps) {
  const t = getPublicTranslator(locale);
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
      <a href={homeHref} className="text-base font-semibold text-fg">
        YourTal
      </a>
      <PublicCtaLink href="/onboarding">{t("header.signUp")}</PublicCtaLink>
    </header>
  );
}

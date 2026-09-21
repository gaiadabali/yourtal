import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

export interface StoreEmptyStateProps {
  /** Whether any of the four filters is narrowing the grid away from the full catalogue. */
  hasActiveFilters: boolean;
  /** YT-0405: required, not defaulted — a missing locale is a compile error, not a silently Indonesian screen. */
  locale: SupportedLocale;
}

/**
 * Empty state for the Store browse grid (mirrors `campaign-empty-state.tsx`
 * from the earn board). Names the cause (a filter combination with no
 * matches) rather than a bare "no results", and gives one action that
 * clears every filter at once.
 */
export function StoreEmptyState({ hasActiveFilters, locale }: StoreEmptyStateProps) {
  // YT-0405: this file was never on the original untranslated list and was
  // still entirely Indonesian. It is a Server Component, so it takes the
  // locale and uses the synchronous translator its siblings use
  // (store-balance-notice.tsx), rather than `useTranslations`, which would
  // have needed a client boundary this screen does not otherwise want.
  const t = getStoreTranslator(locale);
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">
        {hasActiveFilters ? t("store.emptyFiltered") : t("store.emptyNone")}
      </p>
      <p className="max-w-sm text-sm text-fg-muted">
        {hasActiveFilters ? t("store.emptyFilteredBody") : t("store.emptyNoneBody")}
      </p>
      {hasActiveFilters ? (
        <Button asChild variant="secondary">
          <Link href="/store">{t("store.filterClearAll")}</Link>
        </Button>
      ) : null}
    </div>
  );
}

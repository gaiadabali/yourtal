import { ErrorState } from "@yourtal/ui/error-state";
import { StoreBalanceChip } from "@/features/store/store-balance-chip";
import { browseStore } from "@/features/store/store-browse-data";
import { getStoreTranslator } from "@/features/store/store-i18n";
import { parseStoreQuery } from "@/features/store/store-query";
import { StoreShop } from "@/features/store/store-shop";
import { getWalletBalance } from "@/features/wallet/wallet-data";
import { getDisplayLocale } from "@/i18n/get-locale";

/** The store (13.15): a shop of vouchers, filtered and sorted on the server. */
export default async function StorePage(props: PageProps<"/store">) {
  const query = parseStoreQuery(await props.searchParams);
  const [result, balance, locale] = await Promise.all([
    browseStore(query),
    getWalletBalance(),
    getDisplayLocale(),
  ]);
  const t = getStoreTranslator(locale);

  return (
    <div className="flex flex-col gap-5 px-gutter-sm py-5 md:px-gutter-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-headline font-bold text-fg">{t("pageTitle")}</h1>
        {balance.ok ? (
          <StoreBalanceChip points={balance.data.availablePoints} locale={locale} />
        ) : null}
      </div>
      {result.ok ? (
        <StoreShop data={result.data} query={query} locale={locale} base="/store" />
      ) : (
        <ErrorState
          title={t("boardError.title")}
          description={t("boardError.description")}
          retry={
            <a href="/store" className="text-label font-sans font-semibold text-accent">
              {t("errorPanel.retryLabel")}
            </a>
          }
        />
      )}
    </div>
  );
}

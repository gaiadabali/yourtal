import { notFound } from "next/navigation";
import { ErrorState } from "@yourtal/ui/error-state";
import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import { browseStore } from "@/features/store/store-browse-data";
import { getStoreTranslator } from "@/features/store/store-i18n";
import { parseStoreQuery } from "@/features/store/store-query";
import { StoreShop } from "@/features/store/store-shop";
import { getDisplayLocale } from "@/i18n/get-locale";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 13.15.b: one brand's vouchers, with the same filters as the store. */
export default async function StoreBrandPage(props: PageProps<"/store/brand/[merchantId]">) {
  const { merchantId } = await props.params;
  if (!UUID.test(merchantId)) notFound();
  const query = parseStoreQuery(await props.searchParams);
  const [result, locale] = await Promise.all([
    browseStore({ ...query, brands: [] }, merchantId),
    getDisplayLocale(),
  ]);
  const t = getStoreTranslator(locale);
  const base = `/store/brand/${merchantId}`;
  const name = result.ok ? result.data.listings[0]?.merchantName : undefined;
  if (result.ok && name === undefined && query.after === null && result.data.total === 0)
    notFound();

  return (
    <div className="flex flex-col gap-5 px-gutter-sm py-5 md:px-gutter-md">
      <a
        href="/store"
        className="w-fit text-label font-sans font-semibold text-accent hover:underline"
      >
        {t("shop.backToStore")}
      </a>
      <div className="flex items-center gap-4">
        {name ? <ChannelAvatar name={name} size="lg" decorative /> : null}
        <div>
          <h1 className="font-display text-headline font-bold text-fg">{name ?? t("pageTitle")}</h1>
          <p className="text-body-sm font-sans text-fg-muted">{t("shop.brandIntro")}</p>
        </div>
      </div>
      {result.ok ? (
        <StoreShop
          data={result.data}
          query={{ ...query, brands: [] }}
          locale={locale}
          base={base}
          brand={{ name: name ?? "" }}
        />
      ) : (
        <ErrorState
          title={t("boardError.title")}
          description={t("boardError.description")}
          retry={
            <a href={base} className="text-label font-sans font-semibold text-accent">
              {t("errorPanel.retryLabel")}
            </a>
          }
        />
      )}
    </div>
  );
}

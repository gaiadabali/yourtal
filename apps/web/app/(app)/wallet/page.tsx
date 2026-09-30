import { getTranslations } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { ErrorState } from "@yourtal/ui/error-state";
import {
  getWalletBalance,
  listAffordableRewards,
  listWalletHistory,
  listWalletGifts,
  listWalletVouchers,
  nextRewardInReach,
} from "@/features/wallet/wallet-data";
import { HISTORY_FILTERS, type HistoryFilter } from "@/features/wallet/wallet-history";
import { WalletScreen } from "@/features/wallet/wallet-screen";
import { getRegion } from "@/features/region/get-region";
import { getDisplayLocale } from "@/i18n/get-locale";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The wallet (13.19). Tabs, history filter and history page live in the URL. */
export default async function WalletPage(props: PageProps<"/wallet">) {
  const params = await props.searchParams;
  const historyParam = first(params["history"]);
  const after = first(params["after"]);
  const view = {
    tab: first(params["vouchers"]) === "past" ? ("past" as const) : ("active" as const),
    history: HISTORY_FILTERS.includes(historyParam as HistoryFilter)
      ? (historyParam as HistoryFilter)
      : ("all" as const),
    historyAfter: after && after.length <= 200 ? after : null,
  };

  const [balanceResult, vouchersResult, historyResult, region, locale] = await Promise.all([
    getWalletBalance(),
    listWalletVouchers(),
    listWalletHistory(view.historyAfter ?? undefined),
    getRegion(),
    getDisplayLocale(),
  ]);

  if (!balanceResult.ok) {
    const t = await getTranslations("wallet");
    return (
      <PageContainer width="narrow" className="py-6">
        <ErrorState title={t("screen.errorTitle")} description={t("screen.errorBody")} />
      </PageContainer>
    );
  }
  const available = balanceResult.data.availablePoints;
  const [nextReward, affordable, gifts] = await Promise.all([
    nextRewardInReach(available),
    listAffordableRewards(available),
    listWalletGifts(),
  ]);

  return (
    <WalletScreen
      balance={balanceResult.data}
      vouchers={vouchersResult.ok ? vouchersResult.data.vouchers : []}
      history={historyResult.ok ? historyResult.data.entries : []}
      historyNextCursor={historyResult.ok ? historyResult.data.nextCursor : null}
      nextReward={nextReward}
      affordable={affordable}
      gifts={gifts}
      view={view}
      region={region}
      nowMs={Date.now()}
      locale={locale}
    />
  );
}

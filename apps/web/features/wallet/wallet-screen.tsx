import { getTranslations } from "next-intl/server";
import type { PublicListing } from "@yourtal/contracts/listing";
import type { Region } from "@yourtal/contracts/region";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { StoreVoucherCard } from "@/features/store/store-voucher-card";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletEmptyState } from "./wallet-empty-state";
import type { SupportedLocale } from "./wallet-format";
import { WalletHero } from "./wallet-hero";
import { WalletHistory, type HistoryFilter } from "./wallet-history";
import { WalletVouchers, type VoucherTab } from "./wallet-vouchers";

export interface WalletView {
  readonly tab: VoucherTab;
  readonly history: HistoryFilter;
  readonly historyAfter: string | null;
}

export interface WalletScreenProps {
  balance: WalletSummary;
  vouchers: WalletVoucherDetail[];
  history: WalletHistoryEntry[];
  historyNextCursor: string | null;
  nextReward: PublicListing | null;
  affordable: readonly PublicListing[];
  view: WalletView;
  region: Region;
  nowMs: number;
  locale: SupportedLocale;
}

function isWalletEmpty(balance: WalletSummary, vouchers: WalletVoucherDetail[]): boolean {
  return (
    balance.availablePoints === 0 &&
    balance.pendingPoints === 0 &&
    balance.expiringPoints === 0 &&
    vouchers.length === 0
  );
}

export function walletHref(view: WalletView): string {
  const params = new URLSearchParams();
  if (view.tab !== "active") params.set("vouchers", view.tab);
  if (view.history !== "all") params.set("history", view.history);
  if (view.historyAfter) params.set("after", view.historyAfter);
  const qs = params.toString();
  return qs === "" ? "/wallet" : `/wallet?${qs}`;
}

/**
 * 13.19: the wallet, most useful first: the balance and the next reward,
 * active vouchers, what the viewer can get now, then the history.
 */
export async function WalletScreen({
  balance,
  vouchers,
  history,
  historyNextCursor,
  nextReward,
  affordable,
  view,
  region,
  nowMs,
  locale,
}: WalletScreenProps) {
  const t = await getTranslations("wallet");
  const empty = isWalletEmpty(balance, vouchers);
  // Awaited as calls, not JSX, so a test can render this async tree.
  const [top, voucherSection, historySection] = await Promise.all([
    empty ? WalletEmptyState() : WalletHero({ balance, nextReward, locale }),
    empty
      ? null
      : WalletVouchers({
          vouchers,
          tab: view.tab,
          tabHref: (tab) => walletHref({ ...view, tab }),
          nowMs,
          locale,
        }),
    empty && history.length === 0
      ? null
      : WalletHistory({
          entries: history,
          filter: view.history,
          filterHref: (filter) => walletHref({ ...view, history: filter, historyAfter: null }),
          olderHref: historyNextCursor
            ? walletHref({ ...view, historyAfter: historyNextCursor })
            : null,
          region,
          locale,
          nowMs,
        }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-gutter-sm py-6 md:px-gutter-md">
      <h1 className="font-display text-headline font-bold text-fg">{t("screen.title")}</h1>
      {top}
      {voucherSection}

      {affordable.length > 0 ? (
        <section aria-labelledby="wallet-affordable" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="wallet-affordable" className="font-display text-headline font-bold text-fg">
              {t("overview.affordable")}
            </h2>
            <a
              href={`/store?max=${String(balance.availablePoints)}&sort=points_desc`}
              className="text-label font-sans font-semibold text-accent hover:underline"
            >
              {t("overview.seeAllAffordable")}
            </a>
          </div>
          <ul className="flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
            {affordable.map((listing) => (
              <li key={listing.id} className="w-48 shrink-0 snap-start sm:w-56">
                <StoreVoucherCard listing={listing} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {historySection}
    </div>
  );
}

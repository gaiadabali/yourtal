import { getTranslations } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { ErrorState } from "@yourtal/ui/error-state";
import {
  getWalletBalance,
  listWalletHistory,
  listWalletVouchers,
} from "@/features/wallet/wallet-data";
import { WalletScreen } from "@/features/wallet/wallet-screen";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * `/wallet` (6.5.a). Server Component per docs/13b-typescript-standards.md
 * §8; all interactivity lives in the voucher detail leaf, not here.
 *
 * The three reads run in parallel and are checked independently: a failed
 * balance read is fatal to the page (there is no wallet to show without
 * it), but a failed vouchers or history read degrades to an empty section
 * rather than blanking the whole screen — the founder should still see
 * their balance even if, say, the voucher service is the one that is down.
 */
export default async function WalletPage() {
  const [balanceResult, vouchersResult, historyResult, { locale }] = await Promise.all([
    getWalletBalance(),
    listWalletVouchers(),
    listWalletHistory(),
    getRegionDisplayConfig(),
  ]);

  if (!balanceResult.ok) {
    const t = await getTranslations("wallet");
    return (
      <PageContainer width="narrow" className="py-6">
        <ErrorState title={t("screen.errorTitle")} description={t("screen.errorBody")} />
      </PageContainer>
    );
  }

  return (
    <WalletScreen
      balance={balanceResult.data}
      vouchers={vouchersResult.ok ? vouchersResult.data.vouchers : []}
      history={historyResult.ok ? historyResult.data.entries : []}
      nowMs={Date.now()}
      locale={locale}
    />
  );
}

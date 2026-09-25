import {
  getWalletBalance,
  listWalletHistory,
  listWalletVouchers,
} from "@/features/wallet/wallet-data";
import { WalletScreen } from "@/features/wallet/wallet-screen";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * `/wallet` (YT-0423) — replaces the YT-0402 placeholder. Server Component
 * per docs/13b-typescript-standards.md §8; all interactivity lives in the
 * voucher detail leaf, not here.
 */
export default async function WalletPage() {
  const [balance, vouchers, history, { locale }] = await Promise.all([
    getWalletBalance(),
    listWalletVouchers(),
    listWalletHistory(),
    getRegionDisplayConfig(),
  ]);

  return (
    <WalletScreen
      balance={balance}
      vouchers={vouchers}
      history={history}
      nowMs={Date.now()}
      locale={locale}
    />
  );
}

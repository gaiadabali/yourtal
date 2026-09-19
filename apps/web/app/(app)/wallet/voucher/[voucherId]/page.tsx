import { notFound } from "next/navigation";
import { getWalletVoucher } from "@/features/wallet/wallet-data";
import { buildRedemptionInstructions } from "@/features/wallet/wallet-redemption-copy";
import { buildCachedVoucherDetail } from "@/features/wallet/voucher-detail-cache";
import { VoucherDetailView } from "@/features/wallet/voucher-detail-view";

/**
 * `/wallet/voucher/[voucherId]` (YT-0424). Server Component per
 * docs/13b-typescript-standards.md §8; the rotating QR, countdown and
 * cache-first hydration all live in `VoucherDetailView`, the one client
 * leaf in this route.
 */
export default async function WalletVoucherDetailPage(props: PageProps<"/wallet/voucher/[voucherId]">) {
  const { voucherId } = await props.params;
  const voucher = await getWalletVoucher(voucherId);

  if (!voucher) {
    notFound();
  }

  const redemptionInstructions = buildRedemptionInstructions(voucher.merchantName, voucher.partialRedemptionPolicy);
  const initialDetail = buildCachedVoucherDetail(voucher, redemptionInstructions, new Date().toISOString());

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <VoucherDetailView voucherId={voucher.id} initialDetail={initialDetail} />
    </div>
  );
}

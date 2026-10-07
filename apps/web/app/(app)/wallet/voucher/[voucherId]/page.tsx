import { notFound } from "next/navigation";
import { PageContainer } from "@yourtal/ui/page-container";
import { getMeProfile } from "@/features/me/me-data";
import { auctionSource } from "@/features/auction/auction-source";
import { getWalletVoucher, getWalletVoucherQr } from "@/features/wallet/wallet-data";
import { buildCachedVoucherDetail } from "@/features/wallet/voucher-detail-cache";
import { isVoucherRedeemable } from "@/features/wallet/wallet-voucher-status-copy";
import { VoucherDetailView } from "@/features/wallet/voucher-detail-view";

/**
 * `/wallet/voucher/[voucherId]` (6.5.b). Server Component per
 * docs/13b-typescript-standards.md §8; the rotating QR, countdown and
 * cache-first hydration all live in `VoucherDetailView`, the one client
 * leaf in this route.
 *
 * The QR is only fetched for a voucher that is actually redeemable right
 * now — an archived voucher (released, or past `expiresAt`) has nothing to
 * scan, and asking `services/voucher` for one would just be wasted work.
 *
 * The redemption code is deliberately NOT rendered here: it would be stored
 * in the service worker's page cache. `VoucherDetailView` fetches it after
 * mount, through a Server Action.
 */
export default async function WalletVoucherDetailPage(
  props: PageProps<"/wallet/voucher/[voucherId]">,
) {
  const { voucherId } = await props.params;
  const [voucherResult, me] = await Promise.all([getWalletVoucher(voucherId), getMeProfile()]);

  if (!voucherResult.ok) {
    notFound();
  }
  const voucher = voucherResult.data;

  const isRedeemable = isVoucherRedeemable(voucher, Date.now());
  const qrResult = isRedeemable ? await getWalletVoucherQr(voucherId) : null;

  const adult = me.ok && me.data.profile.ageBand === "adult";
  // The same rule as gifting decides listing: transferable, unused, one hop.
  const canPass = isRedeemable && voucher.giftable === true && adult;
  const charities = canPass ? await auctionSource.charities() : null;

  const initialDetail = buildCachedVoucherDetail(voucher, new Date().toISOString());

  return (
    <PageContainer width="narrow" className="py-4">
      <VoucherDetailView
        voucherId={voucher.voucherId}
        initialDetail={initialDetail}
        initialQr={qrResult?.ok ? qrResult.data : null}
        // F86: teens can neither give nor receive gifts; an unknown age offers nothing.
        giftable={canPass}
        {...(charities ? { charities } : {})}
      />
    </PageContainer>
  );
}

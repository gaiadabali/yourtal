import { notFound } from "next/navigation";
import { PageContainer } from "@yourtal/ui/page-container";
import { getMeProfile } from "@/features/me/me-data";
import { auctionSource } from "@/features/auction/auction-source";
import {
  getWalletVoucher,
  getWalletVoucherQr,
  listWalletGifts,
} from "@/features/wallet/wallet-data";
import { passedOnBy } from "@/features/wallet/voucher-passed-on";
import { passOptions } from "@/features/wallet/voucher-pass-rules";
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
  // A voucher redeemed in a partner's app has no QR: its code is typed there.
  const qrResult = isRedeemable && !voucher.redeemIn ? await getWalletVoucherQr(voucherId) : null;

  // The server's `giftable` decides gifting and listing alike: transferable, unused, one hop.
  // When it says no, the page says which rule it was.
  const pass = passOptions({
    redeemable: isRedeemable,
    ageBand: me.ok ? me.data.profile.ageBand : undefined,
    giftable: voucher.giftable,
    giftBlock: voucher.giftBlock,
    expiresAt: voucher.expiresAt,
    nowMs: Date.now(),
  });
  const charities = pass.canList ? await auctionSource.charities() : null;
  // A voucher already passed on: say how, from the gifts this member sent.
  const passedOn =
    voucher.status === "transferred" ? passedOnBy(voucherId, await listWalletGifts()) : null;

  const initialDetail = buildCachedVoucherDetail(voucher, new Date().toISOString());

  return (
    <PageContainer width="narrow" className="py-4">
      <VoucherDetailView
        voucherId={voucher.voucherId}
        initialDetail={initialDetail}
        initialQr={qrResult?.ok ? qrResult.data : null}
        giftable={pass.canGift}
        {...(voucher.redeemIn ? { redeemIn: voucher.redeemIn } : {})}
        {...(pass.notice ? { passNotice: pass.notice } : {})}
        {...(passedOn ? { passedOn } : {})}
        {...(charities ? { charities } : {})}
      />
    </PageContainer>
  );
}

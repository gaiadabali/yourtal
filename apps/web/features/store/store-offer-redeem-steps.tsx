export interface StoreOfferRedeemStepsProps {
  merchantName: string;
  district: string;
}

/**
 * "How to redeem" for the offer detail page (YT-0421 acceptance: "Merchant,
 * locations and how to redeem"). The three steps mirror the settlement
 * protocol's shape (docs/09-points-economy-and-redemption.md §8: the
 * voucher is minted on redemption, then honoured at the merchant's own
 * checkout) without describing the burn flow itself — that flow is
 * YT-0422, owned by a different ticket, and this page only needs to set
 * the user's expectation for what happens after they tap the button here.
 */
export function StoreOfferRedeemSteps({ merchantName, district }: StoreOfferRedeemStepsProps) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-fg">Cara menukar</h2>
      <ol className="flex flex-col gap-1.5 text-xs text-fg-muted">
        <li>1. Tukar poin untuk mendapatkan voucher — harga dan ketentuan di atas berlaku persis seperti yang ditampilkan.</li>
        <li>2. Voucher beserta kode dan QR-nya muncul langsung di Wallet kamu.</li>
        <li>
          3. Tunjukkan kode voucher saat checkout di {merchantName} (lokasi {district}), atau ikuti instruksi redeem di
          website merchant untuk voucher digital.
        </li>
      </ol>
    </div>
  );
}

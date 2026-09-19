import type { Voucher } from "@yourtal/contracts/voucher";
import { WalletVoucherCard } from "./wallet-voucher-card";
import { isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";

export interface WalletVoucherListProps {
  vouchers: Voucher[];
  nowMs: number;
}

function isActiveAndLive(voucher: Voucher, nowMs: number): boolean {
  return voucher.status === "active" && !isVoucherEffectivelyExpired(voucher, nowMs);
}

/**
 * Splits vouchers into an active section and an archived one. Archived
 * vouchers (used, expired or transferred) are never hidden or deleted —
 * YT-0424's "used and expired vouchers archived and still viewable" — they
 * render in their own, visually distinct section below the active ones,
 * always present when there is anything to show there.
 */
export function WalletVoucherList({ vouchers, nowMs }: WalletVoucherListProps) {
  const active = vouchers.filter((voucher) => isActiveAndLive(voucher, nowMs));
  const archived = vouchers.filter((voucher) => !isActiveAndLive(voucher, nowMs));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">Voucher aktif</h2>
        {active.length === 0 ? (
          <p className="text-sm text-fg-muted">Belum ada voucher aktif. Tukar poin di Store untuk mendapatkan voucher.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map((voucher) => (
              <WalletVoucherCard key={voucher.id} voucher={voucher} nowMs={nowMs} />
            ))}
          </div>
        )}
      </section>
      {archived.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-muted">Arsip (terpakai / kedaluwarsa)</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {archived.map((voucher) => (
              <WalletVoucherCard key={voucher.id} voucher={voucher} nowMs={nowMs} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

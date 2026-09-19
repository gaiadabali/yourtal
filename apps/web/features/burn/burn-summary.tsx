import type { Listing } from "@yourtal/contracts/listing";
import { asDisplayIdr, asDisplayPoints, formatIdr, formatPoints } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";

export interface BurnSummaryProps {
  listing: Listing;
  /**
   * Controls only the heading — the figures below never differ between the
   * two, because "the confirmation step restates cost and terms"
   * (docs/tasks/phase-u-ui.md YT-0422) means literally the same numbers,
   * not a re-derived approximation.
   */
  variant?: "review" | "confirmation";
}

const PARTIAL_REDEMPTION_COPY: Record<Listing["partialRedemptionPolicy"], string> = {
  balance_carrying: "Sisa nilai voucher tetap bisa dipakai di transaksi berikutnya.",
  single_use_forfeit: "Voucher hanya untuk satu transaksi; sisa nilai yang tidak terpakai akan hangus.",
  minimum_spend: "Voucher hanya berlaku untuk belanja dengan jumlah minimum tertentu.",
};

/**
 * Restates the points cost, the face value, what the user gets, and the
 * terms that bind — the same four things whether this is the initial
 * review or the final confirmation (docs/tasks/phase-u-ui.md YT-0422's
 * second acceptance criterion). Money is rendered via
 * `@yourtal/contracts/money/format`'s display-only helpers, never a
 * hand-formatted string, and never the full Zod `money` module (that would
 * pull ~100 KB gz into this client-reachable component — docs/13b §8).
 */
export function BurnSummary({ listing, variant = "review" }: BurnSummaryProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-sans font-semibold text-fg">
          {variant === "confirmation" ? "Konfirmasi penukaran" : "Ringkasan penukaran"}
        </h2>
        <Badge variant="outline">{listing.merchantName}</Badge>
      </div>
      <p className="text-base font-sans font-medium text-fg">{listing.title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-sans">
        <dt className="text-fg-muted">Biaya poin</dt>
        <dd className="text-right font-semibold text-price">{formatPoints(asDisplayPoints(listing.priceInPoints))}</dd>
        <dt className="text-fg-muted">Nilai voucher</dt>
        <dd className="text-right text-fg">{formatIdr(asDisplayIdr(listing.faceValueIdr))}</dd>
        <dt className="text-fg-muted">Anda dapat</dt>
        <dd className="text-right text-fg">Voucher {listing.merchantName}</dd>
        {listing.minimumSpendIdr !== null ? (
          <>
            <dt className="text-fg-muted">Minimum belanja</dt>
            <dd className="text-right text-fg">{formatIdr(asDisplayIdr(listing.minimumSpendIdr))}</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs font-sans text-fg-subtle">
        {listing.transferable
          ? "Voucher ini dapat dialihkan satu kali ke pengguna YourTal lain. "
          : "Voucher ini tidak dapat dialihkan. "}
        {PARTIAL_REDEMPTION_COPY[listing.partialRedemptionPolicy]}
      </p>
    </div>
  );
}

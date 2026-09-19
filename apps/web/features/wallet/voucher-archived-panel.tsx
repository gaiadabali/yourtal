export interface VoucherArchivedPanelProps {
  statusLabel: string;
  dateLabel: string;
}

/**
 * Shown instead of a live rotating QR for a used, expired or transferred
 * voucher (YT-0424: "used and expired vouchers archived and still
 * viewable"). The voucher's other details keep rendering around this panel
 * — nothing about the voucher disappears, only its ability to produce a
 * fresh redeemable code.
 */
export function VoucherArchivedPanel({ statusLabel, dateLabel }: VoucherArchivedPanelProps) {
  return (
    <div className="flex h-60 w-60 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface p-4 text-center">
      <p className="text-sm font-semibold text-fg-muted">{statusLabel}</p>
      <p className="text-xs text-fg-subtle">{dateLabel}</p>
    </div>
  );
}

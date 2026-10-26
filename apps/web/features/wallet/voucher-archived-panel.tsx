export interface VoucherArchivedPanelProps {
  /** Why the voucher has no code any more. The status badge beside the title already names the status. */
  message: string;
}

/**
 * Shown instead of a live rotating QR for a used, expired or transferred
 * voucher (YT-0424: "used and expired vouchers archived and still
 * viewable"). The voucher's other details keep rendering around this panel
 * — nothing about the voucher disappears, only its ability to produce a
 * fresh redeemable code.
 */
export function VoucherArchivedPanel({ message }: VoucherArchivedPanelProps) {
  return (
    <div className="flex min-h-60 w-60 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-4 text-center">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}

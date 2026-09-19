import { formatMerchantMoney } from "./merchant-money";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import type { RedemptionReceipt } from "./merchant-redemption";
import { errorCopyFor } from "./merchant-error-copy";
import { recoveryForRedemptionError } from "./merchant-redemption-errors";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { MerchantCopy } from "./merchant-copy";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

export type MerchantOutcome =
  | { kind: "success"; receipt: RedemptionReceipt }
  | { kind: "queued"; voucherCode: string; amountMinor: number; queuedAt: string }
  | { kind: "failed"; error: MerchantRedemptionError };

export interface MerchantOutcomePanelProps {
  outcome: MerchantOutcome;
  locale: MerchantLocale;
  currency: MerchantCurrency;
  copy: MerchantCopy;
  onRetry: () => void;
  onEditAmount: () => void;
  onNewRedemption: () => void;
}

/**
 * The end of one redemption attempt, rendered as exactly one of three
 * honest outcomes (this ticket's central requirement, docs/09 §8 /
 * docs/23-critique.md): a confirmed capture ("success", green), a locally
 * saved attempt still waiting to actually happen ("queued", amber — never
 * styled or worded like success), or a refusal/failure with a specific
 * next step ("failed", red). `role="status"`/`role="alert"` so each
 * outcome is announced.
 */
export function MerchantOutcomePanel({
  outcome,
  locale,
  currency,
  copy,
  onRetry,
  onEditAmount,
  onNewRedemption,
}: MerchantOutcomePanelProps) {
  if (outcome.kind === "success") {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-lg border border-success bg-success/10 p-4"
      >
        <Badge variant="success" className="w-fit text-sm">
          {copy.successHeading}
        </Badge>
        <p className="text-lg font-sans text-fg">
          <span className="font-mono">{outcome.receipt.voucherCode}</span> —{" "}
          <span className="font-semibold tabular-nums">
            {formatMerchantMoney(outcome.receipt.amountCapturedMinor, currency)}
          </span>
        </p>
        <p className="text-sm font-sans text-fg-muted">
          {locale === "id-ID" ? "Sisa nilai voucher: " : "Remaining voucher value: "}
          <span className="tabular-nums">
            {formatMerchantMoney(outcome.receipt.remainingValueMinor, currency)}
          </span>
        </p>
        <Button type="button" size="lg" onClick={onNewRedemption} className="h-14 text-base">
          {copy.newRedemptionButton}
        </Button>
      </div>
    );
  }

  if (outcome.kind === "queued") {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-lg border border-warning bg-warning/10 p-4"
      >
        <Badge variant="warning" className="w-fit text-sm">
          {copy.queuedHeading}
        </Badge>
        <p className="text-lg font-sans text-fg">
          <span className="font-mono">{outcome.voucherCode}</span> —{" "}
          <span className="font-semibold tabular-nums">
            {formatMerchantMoney(outcome.amountMinor, currency)}
          </span>
        </p>
        <p className="text-sm font-sans text-fg">{copy.queuedBody}</p>
        <Button type="button" size="lg" onClick={onNewRedemption} className="h-14 text-base">
          {copy.newRedemptionButton}
        </Button>
      </div>
    );
  }

  const { heading, body } = errorCopyFor(outcome.error, locale, currency);
  const recovery = recoveryForRedemptionError(outcome.error);
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-danger bg-danger/10 p-4"
    >
      <p className="text-lg font-sans font-semibold text-danger">{heading}</p>
      <p className="text-sm font-sans text-fg">{body}</p>
      {recovery.kind === "retry" ? (
        <Button type="button" size="lg" onClick={onRetry} className="h-14 text-base">
          {copy.tryAgainButton}
        </Button>
      ) : recovery.kind === "edit_amount" ? (
        <Button type="button" size="lg" onClick={onEditAmount} className="h-14 text-base">
          {copy.backButton}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onNewRedemption}
          className="h-14 text-base"
        >
          {copy.newRedemptionButton}
        </Button>
      )}
    </div>
  );
}

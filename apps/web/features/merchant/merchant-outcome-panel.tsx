import type { CounterCapture } from "@yourtal/contracts/device/counter-redemption";
import type { Currency } from "@yourtal/contracts/money/currency";
import { formatMerchantMoney } from "./merchant-money";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { errorCopyFor } from "./merchant-redemption-error-copy";
import { recoveryForRedemptionError } from "./merchant-redemption-errors";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { MerchantCopy } from "./merchant-i18n";
import type { MerchantLocale } from "./merchant-device";

export type MerchantOutcome =
  | { kind: "success"; capture: CounterCapture }
  | { kind: "offline" }
  | { kind: "failed"; error: MerchantRedemptionError };

export interface MerchantOutcomePanelProps {
  outcome: MerchantOutcome;
  locale: MerchantLocale;
  currency: Currency;
  copy: MerchantCopy;
  onRetry: () => void;
  onEditAmount: () => void;
  onNewRedemption: () => void;
}

/**
 * The end of one redemption attempt, rendered as exactly one of three
 * honest outcomes (docs/09 §8 / docs/23-critique.md): a confirmed capture
 * ("success", green), a refusal because there is no connection right now
 * ("offline", amber — TASKS.md 8.2.b: never queued, never styled like
 * success), or a refusal/failure with a specific next step ("failed",
 * red). `role="status"`/`role="alert"` so each outcome is announced.
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
        <p className="text-lg font-sans font-semibold tabular-nums text-fg">
          {formatMerchantMoney(outcome.capture.amountMinor, currency)}
        </p>
        <Button type="button" size="lg" onClick={onNewRedemption} className="h-14 text-base">
          {copy.newRedemptionButton}
        </Button>
      </div>
    );
  }

  if (outcome.kind === "offline") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-warning bg-warning/10 p-4"
      >
        <Badge variant="warning" className="w-fit text-sm">
          {copy.cantRedeemOfflineHeading}
        </Badge>
        <p className="text-sm font-sans text-fg">{copy.cantRedeemOfflineBody}</p>
        <Button type="button" size="lg" onClick={onRetry} className="h-14 text-base">
          {copy.tryAgainButton}
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

import { Button } from "@yourtal/ui/button";
import type { MerchantDevice } from "./merchant-device";
import type { MerchantCopy } from "./merchant-copy";
import type { MerchantRedemptionStep } from "./merchant-redemption-state";
import type { MerchantLogEntry } from "./merchant-today-log";
import type { MerchantOutcome } from "./merchant-outcome-panel";
import { MerchantIdentifyPanel } from "./merchant-identify-panel";
import { MerchantReviewForm } from "./merchant-review-form";
import { MerchantOutcomePanel } from "./merchant-outcome-panel";
import { MerchantConnectivityBanner } from "./merchant-connectivity-banner";
import { MerchantTodayLogPanel } from "./merchant-today-log-panel";

export interface MerchantRedemptionFlowViewProps {
  step: MerchantRedemptionStep;
  device: MerchantDevice;
  copy: MerchantCopy;
  isOnline: boolean;
  isSyncing: boolean;
  logEntries: MerchantLogEntry[];
  onSubmitCode: (code: string) => void;
  onScanDetect: (payload: string) => void;
  onAmountChange: (amountMinor: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onEditAmount: () => void;
  onNewRedemption: () => void;
}

function outcomeFor(step: MerchantRedemptionStep): MerchantOutcome | null {
  switch (step.step) {
    case "success":
      return { kind: "success", receipt: step.receipt };
    case "queued":
      return {
        kind: "queued",
        voucherCode: step.voucher.code,
        amountMinor: step.amountMinor,
        queuedAt: step.queuedAt,
      };
    case "failed":
      return { kind: "failed", error: step.error };
    default:
      return null;
  }
}

/**
 * The whole flow's presentation, one screen per `MerchantRedemptionStep`
 * — kept separate from `merchant-redemption-screen.tsx` (which owns the
 * state machine, effects and handlers) purely to stay under the 300-line
 * file limit (docs/13b-typescript-standards.md); this component holds no
 * state of its own, only the render for whichever `step` it is handed.
 *
 * There is no branch here that shows a voucher as redeemed before
 * `processing` resolves to `success` — see `merchant-redemption-screen.tsx`'s
 * doc comment for why that ordering is the ticket's central requirement.
 */
export function MerchantRedemptionFlowView({
  step,
  device,
  copy,
  isOnline,
  isSyncing,
  logEntries,
  onSubmitCode,
  onScanDetect,
  onAmountChange,
  onConfirm,
  onCancel,
  onRetry,
  onEditAmount,
  onNewRedemption,
}: MerchantRedemptionFlowViewProps) {
  const outcome = outcomeFor(step);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-sans font-semibold text-fg">{copy.portalHeading}</h1>
        <p className="text-sm font-sans text-fg-muted">
          {copy.deviceBadgePrefix}: {device.label}
        </p>
        {/* YT-0583: which outlet this device stands in. `label` is the
            counter, not the shop, and a merchant with two branches has
            counters in both — so staff could previously see the till they
            were on but not the store, while the wrong_merchant error told
            them to check "the store named on the voucher". */}
        <p className="text-sm font-sans text-fg-muted">
          {copy.deviceLocationPrefix}: {device.location.name} — {device.location.district}
        </p>
      </header>
      <MerchantConnectivityBanner isOnline={isOnline} isSyncing={isSyncing} copy={copy} />
      {step.step === "identify" ? (
        <MerchantIdentifyPanel
          copy={copy}
          onSubmitCode={onSubmitCode}
          onScanDetect={onScanDetect}
        />
      ) : null}
      {step.step === "looking_up" ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-border bg-surface p-6 text-center text-sm font-sans text-fg-muted"
        >
          {copy.lookUpButton}…
        </div>
      ) : null}
      {step.step === "not_found" ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-danger bg-danger/10 p-4"
        >
          <p className="text-lg font-sans font-semibold text-danger">
            {step.reason === "unreadable" ? copy.unreadableHeading : copy.notFoundHeading}
          </p>
          <p className="text-sm font-sans text-fg">
            {step.reason === "unreadable" ? copy.unreadableBody : copy.notFoundBody}
          </p>
          <Button type="button" size="lg" onClick={onCancel} className="h-14 text-base">
            {copy.tryAgainButton}
          </Button>
        </div>
      ) : null}
      {step.step === "reviewing" ? (
        <MerchantReviewForm
          voucher={step.voucher}
          amountMinor={step.amountMinor}
          effectiveRemainingMinor={step.effectiveRemainingMinor}
          locale={device.locale}
          currency={device.currency}
          copy={copy}
          onAmountChange={onAmountChange}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : null}
      {step.step === "processing" ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-border bg-surface p-6 text-center text-sm font-sans text-fg-muted"
        >
          {step.phase === "authorize" ? copy.processingAuthorize : copy.processingCapture}
        </div>
      ) : null}
      {outcome ? (
        <MerchantOutcomePanel
          outcome={outcome}
          locale={device.locale}
          currency={device.currency}
          copy={copy}
          onRetry={onRetry}
          onEditAmount={onEditAmount}
          onNewRedemption={onNewRedemption}
        />
      ) : null}
      <MerchantTodayLogPanel
        entries={logEntries}
        locale={device.locale}
        currency={device.currency}
        copy={copy}
      />
    </div>
  );
}

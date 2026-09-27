import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import { Button } from "@yourtal/ui/button";
import type { MerchantDevice } from "./merchant-device";
import type { MerchantCopy } from "./merchant-i18n";
import type { MerchantRedemptionStep } from "./merchant-redemption-state";
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
  logEntries: readonly CounterLogEntry[];
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
      return { kind: "success", capture: step.capture };
    case "offline":
      return { kind: "offline" };
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
 * file limit. This component holds no state of its own.
 *
 * TASKS.md 8.1's device-info gap (`merchant-i18n.ts`'s doc comment) means
 * there is no device label or location to show in the header yet — only a
 * generic device badge.
 */
export function MerchantRedemptionFlowView({
  step,
  device,
  copy,
  isOnline,
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
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-sans font-semibold text-fg">{copy.portalHeading}</h1>
        <p className="text-sm font-sans text-fg-muted">
          {copy.deviceBadgePrefix}: {device.id.slice(0, 8)}
        </p>
      </header>
      <MerchantConnectivityBanner isOnline={isOnline} copy={copy} />
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
          preview={step.preview}
          amountMinor={step.amountMinor}
          effectiveRemainingMinor={step.effectiveRemainingMinor}
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
          currency={
            step.step === "success"
              ? step.capture.currency
              : step.step === "offline" || step.step === "failed"
                ? step.preview.currency
                : "AUD"
          }
          copy={copy}
          onRetry={onRetry}
          onEditAmount={onEditAmount}
          onNewRedemption={onNewRedemption}
        />
      ) : null}
      <MerchantTodayLogPanel entries={logEntries} locale={device.locale} copy={copy} />
    </main>
  );
}

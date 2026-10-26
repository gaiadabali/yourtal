"use client";

import { useEffect, useState } from "react";
import type {
  CounterLogEntry,
  CounterVoucherPreview,
} from "@yourtal/contracts/device/counter-redemption";
import type { MerchantDevice } from "./merchant-device";
import { getMerchantCopy } from "./merchant-i18n";
import type { MerchantRedemptionStep } from "./merchant-redemption-state";
import {
  classifyAmount,
  fromApiError,
  type MerchantRedemptionError,
} from "./merchant-redemption-errors";
import {
  counterAuthorizeAction,
  counterCaptureAction,
  counterLogAction,
  counterLookupAction,
} from "./counter-redemption-actions";
import { useOnlineStatus } from "./use-online-status";
import { MerchantRedemptionFlowView } from "./merchant-redemption-flow-view";

export interface MerchantRedemptionScreenProps {
  device: MerchantDevice;
}

/** A basic shape check on a scanned payload — `YT1.<voucherId>.<window>.<hash>`. The server does the real signature check (D16/8.2.f); this only tells "camera decoded something recognisable" from "camera decoded garbage" before spending a round trip on it. */
const SCANNED_PAYLOAD_SHAPE = /^YT1\.[^.]+\.-?\d+\.[0-9a-f]+$/u;

function newOrderRef(): string {
  return `ord_${crypto.randomUUID()}`;
}

/**
 * The client leaf that owns the whole redemption flow's state, effects and
 * handlers (docs/13b-typescript-standards.md §8: `page.tsx` stays a Server
 * Component). The render lives in `merchant-redemption-flow-view.tsx`.
 *
 * TASKS.md 8.2 REWRITE, from a client-side simulation over a bundled
 * voucher catalogue to real (or mocked, `counter-redemption-actions.ts`)
 * server round trips:
 *  1. NEVER shows `success` before capture has actually returned.
 *  2. No offline queue (8.2.b) — an offline confirm is refused outright,
 *     never saved locally to replay later.
 *  3. A retry after `failed` reuses the SAME two idempotency keys (one per
 *     endpoint — see `merchant-redemption-state.ts`'s own doc comment) AND,
 *     once minted, the same `authorizationId` — a capture-side failure
 *     retries capture, not authorize, so a hold already placed is never
 *     re-authorized under a fresh amount.
 */
export function MerchantRedemptionScreen({ device }: MerchantRedemptionScreenProps) {
  const copy = getMerchantCopy(device.locale);
  const isOnline = useOnlineStatus();
  const [step, setStep] = useState<MerchantRedemptionStep>({ step: "identify" });
  const [logEntries, setLogEntries] = useState<CounterLogEntry[]>([]);

  useEffect(() => {
    void refreshLog();
  }, []);

  async function refreshLog() {
    const result = await counterLogAction();
    if (result.ok) {
      setLogEntries(result.data.entries);
    }
  }

  async function resolveCode(code: string, notFoundReason: "no_match" | "unreadable") {
    setStep({ step: "looking_up" });
    const result = await counterLookupAction(code);
    if (!result.ok) {
      setStep({ step: "not_found", reason: notFoundReason });
      return;
    }
    const reviewed = {
      code,
      orderRef: newOrderRef(),
      preview: result.data,
      effectiveRemainingMinor: result.data.remainingValueMinor,
    };
    // A single-use voucher has no amount to choose: it goes straight to the
    // confirm step for its whole value. A balance-carrying one asks first.
    // Nothing is prefilled either way, and nothing is committed before a confirm.
    if (result.data.partialRedemptionPolicy === "single_use") {
      setStep({ step: "confirming", ...reviewed, amountMinor: result.data.remainingValueMinor });
    } else {
      setStep({ step: "reviewing", ...reviewed, amountMinor: null });
    }
  }

  function handleContinue(amountMinor: number) {
    if (step.step === "reviewing") {
      setStep({ ...step, step: "confirming", amountMinor });
    }
  }

  function handleBackFromConfirm() {
    if (step.step !== "confirming") {
      return;
    }
    if (step.preview.partialRedemptionPolicy === "single_use") {
      resetToIdentify();
      return;
    }
    setStep({ ...step, step: "reviewing" });
  }

  function handleSubmitCode(code: string) {
    void resolveCode(code.trim(), "no_match");
  }

  function handleScanDetect(payload: string) {
    const trimmed = payload.trim();
    if (!SCANNED_PAYLOAD_SHAPE.test(trimmed)) {
      setStep({ step: "not_found", reason: "unreadable" });
      return;
    }
    void resolveCode(trimmed, "unreadable");
  }

  function failWith(
    error: MerchantRedemptionError,
    context: {
      code: string;
      orderRef: string;
      preview: CounterVoucherPreview;
      amountMinor: number;
      effectiveRemainingMinor: number;
      authorizeIdempotencyKey: string;
      captureIdempotencyKey: string;
      authorizationId: string | null;
    },
  ) {
    setStep({ step: "failed", error, ...context });
  }

  async function handleConfirm() {
    if (step.step !== "confirming" && step.step !== "failed" && step.step !== "offline") {
      return;
    }
    const { code, orderRef, preview, amountMinor, effectiveRemainingMinor } = step;
    // Two independent keys — one per endpoint, each reused only across a
    // retry of ITS OWN call (merchant-redemption-state.ts's own doc
    // comment on why these can never be the same key).
    const authorizeIdempotencyKey =
      step.step === "failed" ? step.authorizeIdempotencyKey : crypto.randomUUID();
    const captureIdempotencyKey =
      step.step === "failed" ? step.captureIdempotencyKey : crypto.randomUUID();
    let authorizationId = step.step === "failed" ? step.authorizationId : null;

    const amountError = classifyAmount(preview, amountMinor);
    if (amountError) {
      failWith(amountError, {
        code,
        orderRef,
        preview,
        amountMinor,
        effectiveRemainingMinor,
        authorizeIdempotencyKey,
        captureIdempotencyKey,
        authorizationId,
      });
      return;
    }

    if (!isOnline) {
      setStep({ step: "offline", code, orderRef, preview, amountMinor, effectiveRemainingMinor });
      return;
    }

    if (authorizationId === null) {
      setStep({
        step: "processing",
        code,
        orderRef,
        preview,
        amountMinor,
        effectiveRemainingMinor,
        phase: "authorize",
        authorizeIdempotencyKey,
        captureIdempotencyKey,
        authorizationId: null,
      });
      // NOTE: this counter has no POS integration to source a separate
      // basket total from, so orderTotalMinor defaults to the redemption
      // amount itself — a real till would pass its own total here.
      const authResult = await counterAuthorizeAction({
        code,
        amountMinor,
        currency: preview.currency,
        orderRef,
        orderTotalMinor: amountMinor,
        idempotencyKey: authorizeIdempotencyKey,
      });
      if (!authResult.ok) {
        // The server names what is left in its refusal's body, which `apiFetch`
        // does not carry; the screen already knows it from the lookup.
        failWith(
          { ...fromApiError(authResult.error), remainingValueMinor: preview.remainingValueMinor },
          {
            code,
            orderRef,
            preview,
            amountMinor,
            effectiveRemainingMinor,
            authorizeIdempotencyKey,
            captureIdempotencyKey,
            authorizationId: null,
          },
        );
        return;
      }
      authorizationId = authResult.data.authorizationId;
    }

    setStep({
      step: "processing",
      code,
      orderRef,
      preview,
      amountMinor,
      effectiveRemainingMinor,
      phase: "capture",
      authorizeIdempotencyKey,
      captureIdempotencyKey,
      authorizationId,
    });
    const captureResult = await counterCaptureAction({
      authorizationId,
      idempotencyKey: captureIdempotencyKey,
    });
    if (!captureResult.ok) {
      failWith(fromApiError(captureResult.error), {
        code,
        orderRef,
        preview,
        amountMinor,
        effectiveRemainingMinor,
        authorizeIdempotencyKey,
        captureIdempotencyKey,
        authorizationId,
      });
      return;
    }
    setStep({ step: "success", capture: captureResult.data });
    void refreshLog();
  }

  function resetToIdentify() {
    setStep({ step: "identify" });
  }

  function backToReviewing() {
    if (step.step !== "failed" && step.step !== "offline") {
      return;
    }
    if (step.preview.partialRedemptionPolicy === "single_use") {
      // Nothing to edit on a whole-voucher redemption: back to the confirm step.
      setStep({
        step: "confirming",
        code: step.code,
        orderRef: step.orderRef,
        preview: step.preview,
        amountMinor: step.amountMinor,
        effectiveRemainingMinor: step.effectiveRemainingMinor,
      });
      return;
    }
    setStep({
      step: "reviewing",
      code: step.code,
      orderRef: step.orderRef,
      preview: step.preview,
      amountMinor: step.amountMinor,
      effectiveRemainingMinor: step.effectiveRemainingMinor,
    });
  }

  return (
    <MerchantRedemptionFlowView
      step={step}
      device={device}
      copy={copy}
      isOnline={isOnline}
      logEntries={logEntries}
      onSubmitCode={handleSubmitCode}
      onScanDetect={handleScanDetect}
      onContinue={handleContinue}
      onConfirm={() => void handleConfirm()}
      onBackFromConfirm={handleBackFromConfirm}
      onCancel={resetToIdentify}
      onRetry={() => void handleConfirm()}
      onEditAmount={backToReviewing}
      onNewRedemption={resetToIdentify}
    />
  );
}

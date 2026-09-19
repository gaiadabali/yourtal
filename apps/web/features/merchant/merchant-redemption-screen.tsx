"use client";

import { useState } from "react";
import type { Voucher } from "@yourtal/contracts/voucher";
import type { VoucherQrSource } from "@/features/wallet/voucher-qr-rotation";
import type { MerchantDevice } from "./merchant-device";
import { getMerchantCopy } from "./merchant-copy";
import type { MerchantRedemptionStep } from "./merchant-redemption-state";
import { validateScannedPayload } from "./merchant-qr-validation";
import { attemptRedemption, generateIdempotencyKey } from "./merchant-redemption";
import type { MerchantLogEntry } from "./merchant-today-log";
import { effectiveRemainingValue } from "./merchant-today-log";
import { useOnlineStatus } from "./use-online-status";
import { useMerchantTodayLog } from "./use-merchant-today-log";
import { MerchantRedemptionFlowView } from "./merchant-redemption-flow-view";

export interface MerchantRedemptionScreenProps {
  device: MerchantDevice;
  vouchers: Voucher[];
}

/** Simulated per-phase network latency — real enough to make "processing" visible, short enough not to punish a real customer queue. Exported so tests can assert against it instead of a magic number. */
export const PROCESSING_PHASE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A thin wrapper around the live `navigator.onLine` read. Calling it twice
 * across an `await` (see `handleConfirm` below) is deliberate — the whole
 * point is to notice connectivity dropping mid-flight — but a bare
 * `navigator.onLine` re-read is easy to mistake for a constant by static
 * analysis that does not model an intervening `await` as something that
 * could change host/browser state. Routing it through a function call
 * keeps each read honest.
 */
function isDeviceOnline(): boolean {
  return navigator.onLine;
}

function buildLogEntry(
  voucher: Voucher,
  amountMinor: number,
  status: MerchantLogEntry["status"],
  nowIso: string,
  failureReason: string | null,
): MerchantLogEntry {
  return {
    id: `${voucher.id}-${nowIso}`,
    voucherId: voucher.id,
    voucherCode: voucher.code,
    merchantName: voucher.merchantName,
    amountMinor,
    status,
    createdAt: nowIso,
    confirmedAt: status === "confirmed" ? nowIso : null,
    failureReason,
  };
}

/**
 * The client leaf that owns the whole redemption flow's state, effects and
 * handlers (docs/13b-typescript-standards.md §8: `page.tsx` stays a Server
 * Component). The render itself lives in `merchant-redemption-flow-view.tsx`
 * (split out to stay under the 300-line file limit); the local log/offline
 * queue lives in `use-merchant-today-log.ts`.
 *
 * Three things this orchestrator is responsible for getting right, per
 * this ticket's brief:
 *  1. NEVER shows `success` before a (simulated) capture has actually
 *     returned — `handleConfirm` re-checks connectivity between the
 *     authorize and capture phases and falls back to `queued` rather than
 *     guessing if it drops mid-flight.
 *  2. Every redemption — confirmed, queued, or failed — is written to the
 *     local, device+day-scoped log immediately, so a reload mid-transaction
 *     never loses it (this ticket's "survives being interrupted" brief).
 *  3. Reconnecting drains the offline queue automatically (see
 *     `use-merchant-today-log.ts`), re-running the SAME eligibility +
 *     simulated network check every live redemption goes through — a
 *     queued item is never waved through.
 */
export function MerchantRedemptionScreen({ device, vouchers }: MerchantRedemptionScreenProps) {
  const copy = getMerchantCopy(device.locale);
  const isOnline = useOnlineStatus();
  const [step, setStep] = useState<MerchantRedemptionStep>({ step: "identify" });
  const { logEntries, isSyncing, persistLog } = useMerchantTodayLog(device, vouchers, isOnline);

  function queueOffline(voucher: Voucher, amountMinor: number) {
    const nowIso = new Date().toISOString();
    const entry = buildLogEntry(voucher, amountMinor, "pending", nowIso, null);
    persistLog([...logEntries, entry]);
    setStep({ step: "queued", voucher, amountMinor, queuedAt: nowIso });
  }

  async function resolveVoucher(
    voucher: Voucher | undefined,
    notFoundReason: "no_match" | "unreadable",
  ) {
    setStep({ step: "looking_up" });
    await sleep(150);
    if (!voucher) {
      setStep({ step: "not_found", reason: notFoundReason });
      return;
    }
    const effective = effectiveRemainingValue(logEntries, voucher.id, voucher.remainingValueIdr);
    setStep({
      step: "reviewing",
      voucher,
      amountMinor: effective,
      effectiveRemainingMinor: effective,
    });
  }

  function handleSubmitCode(code: string) {
    const normalized = code.trim().toUpperCase();
    void resolveVoucher(
      vouchers.find((candidate) => candidate.code.toUpperCase() === normalized),
      "no_match",
    );
  }

  function handleScanDetect(payload: string) {
    const sources: VoucherQrSource[] = vouchers.map((voucher) => ({
      id: voucher.id,
      code: voucher.code,
      expiresAt: voucher.expiresAt,
    }));
    const validation = validateScannedPayload(payload, sources, Date.now());
    if (!validation.ok) {
      void resolveVoucher(undefined, "unreadable");
      return;
    }
    void resolveVoucher(
      vouchers.find((candidate) => candidate.id === validation.voucherId),
      "unreadable",
    );
  }

  async function handleConfirm() {
    if (step.step !== "reviewing" && step.step !== "failed") {
      return;
    }
    const { voucher, amountMinor, effectiveRemainingMinor } = step;
    // A retry after `failed` reuses that attempt's idempotency key
    // (docs/09 §8.1); a fresh confirm from `reviewing` mints a new one.
    const idempotencyKey =
      step.step === "failed" ? step.idempotencyKey : generateIdempotencyKey(voucher.id, Date.now());

    if (!isOnline) {
      queueOffline(voucher, amountMinor);
      return;
    }

    setStep({
      step: "processing",
      voucher,
      amountMinor,
      effectiveRemainingMinor,
      phase: "authorize",
      idempotencyKey,
    });
    await sleep(PROCESSING_PHASE_DELAY_MS);
    if (!isDeviceOnline()) {
      // Connectivity dropped mid-flight, between authorize and capture:
      // never guess. Queue rather than claim either outcome.
      queueOffline(voucher, amountMinor);
      return;
    }
    setStep((current) =>
      current.step === "processing" ? { ...current, phase: "capture" } : current,
    );
    await sleep(PROCESSING_PHASE_DELAY_MS);
    if (!isDeviceOnline()) {
      queueOffline(voucher, amountMinor);
      return;
    }

    const result = attemptRedemption({
      voucher,
      deviceMerchantId: device.merchantId,
      deviceMerchantName: device.merchantName,
      amountMinor,
      effectiveRemainingMinor,
      nowMs: Date.now(),
      idempotencyKey,
    });
    const nowIso = new Date().toISOString();
    if (result.ok) {
      persistLog([...logEntries, buildLogEntry(voucher, amountMinor, "confirmed", nowIso, null)]);
      setStep({ step: "success", receipt: result.receipt });
    } else {
      persistLog([
        ...logEntries,
        buildLogEntry(voucher, amountMinor, "failed", nowIso, result.error.type),
      ]);
      setStep({
        step: "failed",
        error: result.error,
        voucher,
        amountMinor,
        effectiveRemainingMinor,
        idempotencyKey,
      });
    }
  }

  function resetToIdentify() {
    setStep({ step: "identify" });
  }

  function backToReviewing() {
    if (step.step === "failed") {
      setStep({
        step: "reviewing",
        voucher: step.voucher,
        amountMinor: step.amountMinor,
        effectiveRemainingMinor: step.effectiveRemainingMinor,
      });
    }
  }

  return (
    <MerchantRedemptionFlowView
      step={step}
      device={device}
      copy={copy}
      isOnline={isOnline}
      isSyncing={isSyncing}
      logEntries={logEntries}
      onSubmitCode={handleSubmitCode}
      onScanDetect={handleScanDetect}
      onAmountChange={(amountMinor) =>
        step.step === "reviewing" ? setStep({ ...step, amountMinor }) : undefined
      }
      onConfirm={() => void handleConfirm()}
      onCancel={resetToIdentify}
      onRetry={() => void handleConfirm()}
      onEditAmount={backToReviewing}
      onNewRedemption={resetToIdentify}
    />
  );
}

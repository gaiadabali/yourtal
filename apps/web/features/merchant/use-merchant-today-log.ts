"use client";

import { useEffect, useMemo, useState } from "react";
import type { Voucher } from "@yourtal/contracts/voucher";
import type { MerchantDevice } from "./merchant-device";
import { attemptRedemption } from "./merchant-redemption";
import type { MerchantLogEntry } from "./merchant-today-log";
import {
  dayKeyFor,
  effectiveRemainingValue,
  readTodayLog,
  writeTodayLog,
} from "./merchant-today-log";

const PROCESSING_PHASE_DELAY_MS = 400;

export interface UseMerchantTodayLogResult {
  dayKey: string;
  logEntries: MerchantLogEntry[];
  isSyncing: boolean;
  /** Appends/replaces the log and writes it through to storage in one step — every caller must go through this, never `setState` directly, so a write is never forgotten. */
  persistLog: (next: MerchantLogEntry[]) => void;
}

/**
 * Owns the device+day-scoped local redemption log (`merchant-today-log.ts`):
 * loads it on mount and drains any `pending` (offline-queued) entries
 * whenever connectivity is present — including right at mount, which is
 * what lets a reload after an offline session still finish syncing once
 * the page comes back online. Reads storage fresh at the start of every
 * run rather than trusting React state, so it never acts on a stale
 * snapshot from before its own writes.
 *
 * Draining re-runs the SAME `attemptRedemption` eligibility + simulated
 * network check every live confirm goes through (`merchant-redemption.ts`)
 * — a queued item is never waved through just because it is being synced
 * rather than confirmed live.
 */
export function useMerchantTodayLog(
  device: MerchantDevice,
  vouchers: Voucher[],
  isOnline: boolean,
): UseMerchantTodayLogResult {
  const [isSyncing, setIsSyncing] = useState(false);
  const [logEntries, setLogEntries] = useState<MerchantLogEntry[]>([]);
  const dayKey = useMemo(() => dayKeyFor(Date.now()), []);

  useEffect(() => {
    // A plain mutable ref object, not a `let` boolean: this is read after
    // an `await` inside a loop two closures deep, and a bare `let` there
    // gets over-narrowed by static analysis (it cannot see that the
    // effect's own cleanup, a sibling closure, may have already run by
    // the time the loop resumes). An object property is not a candidate
    // for that narrowing, so the check stays a real, live read.
    const cancelledRef = { current: false };
    const current = readTodayLog(device.id, dayKey);
    setLogEntries(current);
    const pending = current.filter((entry) => entry.status === "pending");

    if (isOnline && pending.length > 0) {
      setIsSyncing(true);
      void (async () => {
        let working = current;
        for (const entry of pending) {
          await new Promise((resolve) => setTimeout(resolve, PROCESSING_PHASE_DELAY_MS));
          if (cancelledRef.current) {
            return;
          }
          const voucher = vouchers.find((candidate) => candidate.id === entry.voucherId);
          const nowIso = new Date().toISOString();
          if (!voucher) {
            working = working.map((item) =>
              item.id === entry.id
                ? { ...item, status: "failed", failureReason: "voucher_not_found" }
                : item,
            );
          } else {
            const effective = effectiveRemainingValue(
              working.filter((item) => item.id !== entry.id),
              voucher.id,
              voucher.remainingValueIdr,
            );
            const result = attemptRedemption({
              voucher,
              deviceMerchantId: device.merchantId,
              deviceMerchantName: device.merchantName,
              amountMinor: entry.amountMinor,
              effectiveRemainingMinor: effective,
              nowMs: Date.now(),
              idempotencyKey: entry.id,
            });
            working = working.map((item) =>
              item.id === entry.id
                ? result.ok
                  ? { ...item, status: "confirmed", confirmedAt: nowIso }
                  : { ...item, status: "failed", failureReason: result.error.type }
                : item,
            );
          }
          setLogEntries(working);
          writeTodayLog(device.id, dayKey, working);
        }
        if (!cancelledRef.current) {
          setIsSyncing(false);
        }
      })();
    }

    return () => {
      cancelledRef.current = true;
    };
  }, [device.id, device.merchantName, dayKey, isOnline, vouchers]);

  function persistLog(next: MerchantLogEntry[]) {
    setLogEntries(next);
    writeTodayLog(device.id, dayKey, next);
  }

  return { dayKey, logEntries, isSyncing, persistLog };
}

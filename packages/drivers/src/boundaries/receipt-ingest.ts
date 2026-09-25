import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Reading a photographed receipt so a spend can be attributed.
 *
 * ## Confidence is on the result, not hidden behind a threshold
 *
 * An OCR boundary that returned only the extracted fields would let every
 * caller treat a blurry guess as a fact. Real receipts are photographed in
 * bad light at an angle, so "low confidence" is the common case rather than
 * an error — and the decision of what to do about it (hold for review, ask
 * for a retake, accept) belongs to the domain, not to this driver.
 *
 * So the driver reports what it read AND how sure it is, and refuses only
 * when it read nothing at all. A threshold baked in here would be a product
 * rule buried in an adapter, changeable only by someone reading this file.
 *
 * The amount is minor units and carries its currency, like everything else
 * on the value path since YT-0513 — an OCR'd total is exactly where a bare
 * integer would acquire the wrong unit.
 */

export interface ReceiptExtraction {
  readonly merchantName: string;
  readonly totalMinor: number;
  readonly currency: Currency;
  readonly purchasedAtIso: string;
  /** 0 to 1. The caller decides what is good enough. */
  readonly confidence: number;
}

export interface ReceiptIngestDriver {
  readonly mode: DriverMode;
  extract(imageRef: string): Promise<Result<ReceiptExtraction, BoundaryFailure>>;
}

/** Image references the simulator recognises, one per realistic outcome. */
export const SIMULATED_RECEIPTS = {
  clear: "sim-receipt-clear",
  blurry: "sim-receipt-blurry",
  unreadable: "sim-receipt-unreadable",
} as const;

export function createSimulatedReceiptIngest(faultPlan?: FaultPlan): ReceiptIngestDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",

    extract(imageRef: string): Promise<Result<ReceiptExtraction, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("receipt_ingest", directive)));
      }

      if (imageRef === SIMULATED_RECEIPTS.unreadable) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "receipt_ingest",
            detail: "Nothing legible in the image.",
            mayHaveSucceeded: false,
          }),
        );
      }

      const blurry = imageRef === SIMULATED_RECEIPTS.blurry;
      return Promise.resolve(
        ok({
          merchantName: blurry ? "T0k0 Berk4h" : "Toko Berkah",
          // Rp 45.000, stored in whole Rupiah (FOUNDER DECISION T-1).
          totalMinor: 45_000,
          currency: "IDR",
          purchasedAtIso: "2026-09-20T03:15:00.000Z",
          // Deliberately above zero: a blurry read is a usable guess, and a
          // caller that treats it as a failure loses receipts it could have
          // queued for human review.
          confidence: blurry ? 0.42 : 0.97,
        }),
      );
    },
  };
}

export function createReceiptIngestDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): ReceiptIngestDriver {
  return mode === "simulated"
    ? createSimulatedReceiptIngest(faultPlan)
    : refuseLiveDriver("receipt_ingest");
}

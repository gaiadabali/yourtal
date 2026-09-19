import type { Voucher } from "@yourtal/contracts/voucher";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { RedemptionReceipt } from "./merchant-redemption";

/**
 * The whole redemption flow's state as a discriminated union on `step`
 * (docs/13b-typescript-standards.md §4's pattern, applied to UI flow state
 * — same discipline as `apps/web/features/burn/burn-flow-state.ts`). Every
 * render in `merchant-redemption-screen.tsx` is exactly one of these
 * shapes, never an ad hoc combination of booleans that could contradict
 * each other (e.g. "processing" and "showing a success receipt" both
 * true).
 *
 * There is no step that shows a voucher as redeemed before `processing`
 * has resolved to `success` — that ordering IS the ticket's central
 * honesty requirement (docs/09 §8's authorize -> capture; docs/23's
 * critique of claiming success early). `queued` is a distinct, visually
 * different outcome from `success`, never a synonym for it: it is reached
 * when the device is offline at the moment of confirming, and it says so.
 */
export type MerchantRedemptionStep =
  /** The default screen: scan or type a code. */
  | { step: "identify" }
  /** A code was submitted; resolving it against the cached catalogue. */
  | { step: "looking_up" }
  /**
   * No voucher matches what was scanned or typed. `reason` distinguishes a
   * genuinely wrong/nonexistent code ("no_match") from a QR that decoded
   * but failed the rotating-payload check — malformed, for an unrecognised
   * voucher, or stale/mis-signed ("unreadable") — so the message can say
   * "try scanning again" instead of the more alarming "no voucher exists"
   * when the likely cause is a decode/timing hiccup, not a bad code.
   */
  | { step: "not_found"; reason: "no_match" | "unreadable" }
  /** Voucher found; staff reviews it and sets the amount before confirming. */
  | { step: "reviewing"; voucher: Voucher; amountMinor: number; effectiveRemainingMinor: number }
  /** Confirmed; the (simulated) authorize -> capture call is in flight. */
  | {
      step: "processing";
      voucher: Voucher;
      amountMinor: number;
      effectiveRemainingMinor: number;
      phase: "authorize" | "capture";
      idempotencyKey: string;
    }
  /** Capture confirmed — the only step allowed to say "redeemed". */
  | { step: "success"; receipt: RedemptionReceipt }
  /** Offline at the moment of confirming: saved locally, not yet true. */
  | { step: "queued"; voucher: Voucher; amountMinor: number; queuedAt: string }
  /**
   * The attempt was refused or failed; still holds the reviewed context so
   * "retry"/"edit amount" can resume without starting over. Carries the
   * SAME `idempotencyKey` the failed attempt used — docs/09 §8.1's
   * "idempotency key mandatory on every call" is only meaningful if a
   * retry of a genuinely-failed attempt reuses it rather than minting a
   * fresh one, which is what would let a real idempotent backend collapse
   * a retried double-submit into one redemption instead of two.
   */
  | {
      step: "failed";
      error: MerchantRedemptionError;
      voucher: Voucher;
      amountMinor: number;
      effectiveRemainingMinor: number;
      idempotencyKey: string;
      /** How many attempts this key has had. A retry must not look like a first call. */
      attempt: number;
    };

import type {
  CounterCapture,
  CounterVoucherPreview,
} from "@yourtal/contracts/device/counter-redemption";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";

/**
 * The whole redemption flow's state as a discriminated union on `step`
 * (docs/13b-typescript-standards.md §4). Every render in
 * `merchant-redemption-screen.tsx` is exactly one of these shapes.
 *
 * There is no step that shows a voucher as redeemed before `processing`
 * has resolved to `success` (docs/09 §8's authorize -> capture; docs/23's
 * critique of claiming success early). TASKS.md 8.2.b REWRITE: `offline`
 * replaces the old `queued` step — a device with no connection is refused
 * outright, never saved for later.
 */
export type MerchantRedemptionStep =
  /** The default screen: scan or type a code. */
  | { step: "identify" }
  /** A code was submitted; resolving it against the server. */
  | { step: "looking_up" }
  /**
   * No voucher matches what was scanned or typed. `reason` distinguishes a
   * genuinely wrong/nonexistent code ("no_match", the server's own
   * `voucher_not_found`) from a QR that plainly failed to decode
   * ("unreadable", caught client-side before any server round trip).
   */
  | { step: "not_found"; reason: "no_match" | "unreadable" }
  /** Voucher found; staff reviews it and sets the amount before confirming. */
  | {
      step: "reviewing";
      code: string;
      orderRef: string;
      preview: CounterVoucherPreview;
      amountMinor: number;
      effectiveRemainingMinor: number;
    }
  /** Confirmed; the real (or mocked) authorize -> capture call is in flight. */
  | {
      step: "processing";
      code: string;
      orderRef: string;
      preview: CounterVoucherPreview;
      amountMinor: number;
      effectiveRemainingMinor: number;
      phase: "authorize" | "capture";
      idempotencyKey: string;
      /** Set once authorize returns, before capture is attempted — needed so a retry after a capture-side failure calls capture again rather than re-authorizing. */
      authorizationId: string | null;
    }
  /** Capture confirmed — the only step allowed to say "redeemed". */
  | { step: "success"; capture: CounterCapture }
  /** No connection at the moment of confirming (TASKS.md 8.2.b: refused, never queued). */
  | {
      step: "offline";
      code: string;
      orderRef: string;
      preview: CounterVoucherPreview;
      amountMinor: number;
      effectiveRemainingMinor: number;
    }
  /**
   * The attempt was refused or failed; still holds the reviewed context so
   * "retry"/"edit amount" can resume without starting over. Carries the
   * SAME `idempotencyKey` (and, once minted, the same `authorizationId`) the
   * failed attempt used, so a retry never looks like a first call.
   */
  | {
      step: "failed";
      error: MerchantRedemptionError;
      code: string;
      orderRef: string;
      preview: CounterVoucherPreview;
      amountMinor: number;
      effectiveRemainingMinor: number;
      idempotencyKey: string;
      authorizationId: string | null;
    };

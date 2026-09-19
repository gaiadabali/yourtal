import { evaluateRateLimit } from "./otp-rate-limit";
import { RESEND_COOLDOWN_MS, RESEND_LIMIT, VERIFY_ATTEMPT_LIMIT } from "./otp-mock-service";

/**
 * The phone + OTP flow's whole state, as one object discriminated by
 * `phase` (docs/13b-typescript-standards.md section 4's pattern, matching
 * `features/burn/burn-flow-state.ts`). Kept as one flat shape rather than a
 * fully-partitioned union of five variant shapes because `resendAttempts`
 * and `verifyAttempts` are genuinely long-lived across most phases (a
 * resend attempt made in `code` must still count once the flow reaches
 * `rate_limited`); `phase` remains the single source of truth every render
 * switches on (`phone-verification-flow.tsx`), so no ad hoc boolean
 * combination can contradict another.
 *
 * Pulled out of the component entirely so the whole state machine —
 * including the rate-limit and rate-limited/wrong-number/resend states that
 * docs/tasks/phase-u-ui.md YT-0430 explicitly calls out as usually skipped
 * — is unit-testable with plain function calls, no React, no timers.
 */
export interface PhoneFlowState {
  readonly phase: "phone" | "sending" | "code" | "verifying" | "rate_limited" | "verified";
  readonly phone: string;
  readonly code: string;
  readonly codeError: boolean;
  readonly resendAvailableAt: number | null;
  readonly resendAttempts: readonly number[];
  readonly verifyAttempts: readonly number[];
  readonly rateLimitReason: "resend" | "verify" | null;
  readonly retryAt: number | null;
}

export const initialPhoneFlowState: PhoneFlowState = {
  phase: "phone",
  phone: "",
  code: "",
  codeError: false,
  resendAvailableAt: null,
  resendAttempts: [],
  verifyAttempts: [],
  rateLimitReason: null,
  retryAt: null,
};

export type PhoneFlowAction =
  | { readonly type: "phone_changed"; readonly phone: string }
  | { readonly type: "send_requested"; readonly now: number }
  | { readonly type: "send_delivered"; readonly now: number }
  | { readonly type: "code_changed"; readonly code: string }
  | { readonly type: "verify_requested"; readonly now: number }
  | { readonly type: "verify_resolved"; readonly correct: boolean }
  | { readonly type: "edit_number_requested" };

export function phoneFlowReducer(state: PhoneFlowState, action: PhoneFlowAction): PhoneFlowState {
  switch (action.type) {
    case "phone_changed":
      return state.phase === "phone" ? { ...state, phone: action.phone } : state;

    case "send_requested": {
      const limit = evaluateRateLimit(state.resendAttempts, action.now, RESEND_LIMIT);
      if (limit.limited) {
        return {
          ...state,
          phase: "rate_limited",
          rateLimitReason: "resend",
          retryAt: limit.retryAt,
        };
      }
      return {
        ...state,
        phase: "sending",
        resendAttempts: [...state.resendAttempts, action.now],
      };
    }

    case "send_delivered":
      return state.phase === "sending"
        ? {
            ...state,
            phase: "code",
            code: "",
            codeError: false,
            resendAvailableAt: action.now + RESEND_COOLDOWN_MS,
          }
        : state;

    case "code_changed":
      return state.phase === "code" ? { ...state, code: action.code, codeError: false } : state;

    case "verify_requested": {
      if (state.phase !== "code") {
        return state;
      }
      const limit = evaluateRateLimit(state.verifyAttempts, action.now, VERIFY_ATTEMPT_LIMIT);
      if (limit.limited) {
        return {
          ...state,
          phase: "rate_limited",
          rateLimitReason: "verify",
          retryAt: limit.retryAt,
        };
      }
      return {
        ...state,
        phase: "verifying",
        verifyAttempts: [...state.verifyAttempts, action.now],
      };
    }

    case "verify_resolved":
      if (state.phase !== "verifying") {
        return state;
      }
      return action.correct
        ? { ...state, phase: "verified" }
        : { ...state, phase: "code", code: "", codeError: true };

    case "edit_number_requested":
      // Resets the attempt history: those counters belonged to the number
      // just being abandoned, not to whatever the user types next.
      return {
        ...initialPhoneFlowState,
        phone: state.phone,
      };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

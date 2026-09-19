import { describe, expect, it } from "vitest";
import { RESEND_LIMIT, VERIFY_ATTEMPT_LIMIT } from "./otp-mock-service";
import { initialPhoneFlowState, phoneFlowReducer } from "./phone-verification-reducer";
import type { PhoneFlowState } from "./phone-verification-reducer";

const NOW = 1_000_000;

function withPhone(phone: string): PhoneFlowState {
  return { ...initialPhoneFlowState, phase: "phone", phone };
}

describe("phoneFlowReducer", () => {
  it("moves phone -> sending -> (send_delivered) -> code", () => {
    const sending = phoneFlowReducer(withPhone("0411222333"), { type: "send_requested", now: NOW });
    expect(sending.phase).toBe("sending");
    expect(sending.resendAttempts).toStrictEqual([NOW]);

    const code = phoneFlowReducer(sending, { type: "send_delivered", now: NOW + 500 });
    expect(code.phase).toBe("code");
    expect(code.resendAvailableAt).toBeGreaterThan(NOW + 500);
  });

  it("wrong code returns to the code phase with codeError set, clearing the code for retry", () => {
    let state = phoneFlowReducer(withPhone("0411222333"), { type: "send_requested", now: NOW });
    state = phoneFlowReducer(state, { type: "send_delivered", now: NOW });
    state = phoneFlowReducer(state, { type: "code_changed", code: "000000" });
    state = phoneFlowReducer(state, { type: "verify_requested", now: NOW });
    expect(state.phase).toBe("verifying");

    state = phoneFlowReducer(state, { type: "verify_resolved", correct: false });
    expect(state.phase).toBe("code");
    expect(state.codeError).toBe(true);
    expect(state.code).toBe("");
  });

  it("correct code moves verifying -> verified", () => {
    let state = phoneFlowReducer(withPhone("0411222333"), { type: "send_requested", now: NOW });
    state = phoneFlowReducer(state, { type: "send_delivered", now: NOW });
    state = phoneFlowReducer(state, { type: "verify_requested", now: NOW });
    state = phoneFlowReducer(state, { type: "verify_resolved", correct: true });
    expect(state.phase).toBe("verified");
  });

  it("rate-limits resend after the configured number of sends within the window, and says when retry is possible", () => {
    let state = withPhone("0411222333");
    const sendTimes: number[] = [];
    for (let i = 0; i < RESEND_LIMIT.maxAttempts; i += 1) {
      const now = NOW + i * 1_000;
      sendTimes.push(now);
      state = phoneFlowReducer(state, { type: "send_requested", now });
      state = phoneFlowReducer(state, { type: "send_delivered", now });
    }
    expect(state.phase).toBe("code");

    const oneMoreAttemptAt = NOW + RESEND_LIMIT.maxAttempts * 1_000;
    const limited = phoneFlowReducer(state, { type: "send_requested", now: oneMoreAttemptAt });
    expect(limited.phase).toBe("rate_limited");
    expect(limited.rateLimitReason).toBe("resend");
    expect(limited.retryAt).toBe((sendTimes[0] ?? 0) + RESEND_LIMIT.windowMs);
  });

  it("rate-limits verification attempts after the configured number of wrong codes", () => {
    let state = withPhone("0411222333");
    state = phoneFlowReducer(state, { type: "send_requested", now: NOW });
    state = phoneFlowReducer(state, { type: "send_delivered", now: NOW });

    for (let i = 0; i < VERIFY_ATTEMPT_LIMIT.maxAttempts; i += 1) {
      const now = NOW + i * 1_000;
      state = phoneFlowReducer(state, { type: "code_changed", code: "000000" });
      state = phoneFlowReducer(state, { type: "verify_requested", now });
      state = phoneFlowReducer(state, { type: "verify_resolved", correct: false });
    }

    state = phoneFlowReducer(state, { type: "code_changed", code: "000000" });
    const limited = phoneFlowReducer(state, {
      type: "verify_requested",
      now: NOW + VERIFY_ATTEMPT_LIMIT.maxAttempts * 1_000,
    });
    expect(limited.phase).toBe("rate_limited");
    expect(limited.rateLimitReason).toBe("verify");
    expect(limited.retryAt).not.toBeNull();
  });

  it("wrong number resets to phone entry, keeping the typed digits but clearing attempt history", () => {
    let state = withPhone("0411222333");
    state = phoneFlowReducer(state, { type: "send_requested", now: NOW });
    state = phoneFlowReducer(state, { type: "edit_number_requested" });

    expect(state.phase).toBe("phone");
    expect(state.phone).toBe("0411222333");
    expect(state.resendAttempts).toStrictEqual([]);
    expect(state.verifyAttempts).toStrictEqual([]);
  });
});

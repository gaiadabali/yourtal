import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_NETWORK_DELAY_MS, RESEND_COOLDOWN_MS } from "./otp-mock-service";
import { PhoneVerificationFlow } from "./phone-verification-flow";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

/**
 * `fireEvent`, not `userEvent`, throughout this file: `userEvent`'s internal
 * async scheduling does not mix reliably with `vi.useFakeTimers()` (it hangs
 * waiting on a real timer that will never fire) — the same finding
 * `features/burn/burn-flow.test.tsx` documents for the same reason. This
 * flow's whole point is its timers (the mock network delay, the resend
 * cooldown, the rate-limit window), so fake timers are non-negotiable here.
 */
function advanceMs(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function sendCode(phone = "0411222333"): void {
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  advanceMs(MOCK_NETWORK_DELAY_MS);
}

function enterAndVerify(code: string): void {
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  advanceMs(MOCK_NETWORK_DELAY_MS);
}

describe("PhoneVerificationFlow", () => {
  beforeEach(() => {
    push.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks phone -> code -> verified, then auto-advances to the interest picker", () => {
    render(<PhoneVerificationFlow region="AU" />);

    expect(screen.getByRole("heading", { name: "What's your number?" })).toBeInTheDocument();
    sendCode();

    expect(screen.getByRole("heading", { name: "Enter the code" })).toBeInTheDocument();
    expect(screen.getByText(/0411222333/)).toBeInTheDocument();

    enterAndVerify("123456");
    expect(screen.getByText("Number confirmed")).toBeInTheDocument();

    advanceMs(1_000);
    expect(push).toHaveBeenCalledWith("/onboarding/AU/interests");
  });

  it("shows a plain-language error on a wrong code and lets the user retry, without losing the phone number", () => {
    render(<PhoneVerificationFlow region="AU" />);
    sendCode();

    enterAndVerify("000000");

    expect(screen.getByRole("alert")).toHaveTextContent("That code doesn't match");
    // Still on the code screen for the same number — not bounced back to phone entry.
    expect(screen.getByText(/0411222333/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("disables resend during the cooldown and re-enables it once the cooldown elapses", () => {
    render(<PhoneVerificationFlow region="AU" />);
    sendCode();

    expect(screen.getByRole("button", { name: /resend/i })).toBeDisabled();

    advanceMs(RESEND_COOLDOWN_MS);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("lets the user go back and edit a wrong number, discarding the in-flight code", () => {
    render(<PhoneVerificationFlow region="AU" />);
    sendCode();

    fireEvent.click(screen.getByRole("button", { name: "Wrong number? Edit it" }));

    expect(screen.getByRole("heading", { name: "What's your number?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveValue("0411222333");
  });

  it("rate-limits repeated resends and states when retry becomes possible, instead of refusing silently", () => {
    render(<PhoneVerificationFlow region="AU" />);
    sendCode();

    // RESEND_LIMIT allows 3 sends per 30 minutes; the initial send above is
    // the 1st. Two more resends stay under the cap, a 4th trips it.
    for (let i = 0; i < 2; i += 1) {
      advanceMs(RESEND_COOLDOWN_MS);
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
      advanceMs(MOCK_NETWORK_DELAY_MS);
    }

    advanceMs(RESEND_COOLDOWN_MS);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts");
    expect(screen.getByRole("alert")).toHaveTextContent("You can try again at");
  });
});
